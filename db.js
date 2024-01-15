require("./global.js");

function get_job_tasks_done(jobid) {
  	var sql = `SELECT frame FROM tasks WHERE (jobid = ${jobid}) AND (status = 'DONE');`;
	return execSql(sql)
	.then(function (result) {
		return result.map(task => task.frame);
	})
}

function update_table_entry_by_id(tablename, idfieldname, id, data) {
  	var sql = `UPDATE ${tablename} SET `;
  	var comma = '';
  	for (const [key, value] of Object.entries(data)) {
	    sql += `${comma}${key} = '${value}'`
	    comma = ', '
	}
	if(typeof(id) == "number")
  		sql += ` WHERE ${idfieldname} = ${id};`;
  	else
  		sql += ` WHERE ${idfieldname} = '${id}';`;
	return execSql(sql)
	.then(function (result) {
		return result;
	})
}

function monitoring_by_wallet(walletaddress) {
	var limit_date = utils.get_mysql_date_m7d();
  	var jobsSql = `	SELECT job.jobid, job.clientid, job.jobuuid, job.jobindex AS jobIndex, job.status, parameters.scene, parameters.startframe, parameters.stopframe, parameters.stepframe, tasksDone, jobs2.current_job
					FROM jobs job
					NATURAL JOIN parameters
					NATURAL JOIN (SELECT MAX(jobid) AS current_job FROM jobs WHERE status = 'DONE') jobs2
					LEFT JOIN (SELECT jobid, count(*) tasksDone FROM tasks WHERE status = 'DONE' GROUP BY jobid) task2
					ON (job.jobid = task2.jobid) AND (job.walletaddress = '${walletaddress}') AND ((job.status != 'DONE') OR (job.finishedat > '${limit_date}'))
					ORDER BY job.createdat ASC`;
	return execSql(jobsSql)
	.then(function (jobs) {
		jobs.forEach((job) => {
			job.totalFrames = utils.range(job.startframe, job.stopframe + 1, job.stepframe).length;
			if(job.status == 'DONE') {
				job.path = `${job.clientid}/${job.jobuuid}/${job.clientid}_${job.jobuuid}.zip`;
				job.poolPosition = -1;
			}
			else {
				job.path = '';
				job.poolPosition = job.jobid - job.current_job - 1;
				if(job.tasks_done == null)
					job.tasks_done = 0;
			}

			delete job.startframe;
			delete job.stopframe;
			delete job.stepframe;
			delete job.clientid;
			delete job.jobuuid;
			delete job.jobid;
			delete job.current_job;
		});
		return jobs
	})
}

function get_job() {
	var job = null;
  	var jobSql = `  SELECT *
					FROM jobs job
					NATURAL JOIN parameters
					WHERE job.status != 'DONE'
					ORDER BY job.createdat ASC LIMIT 1`;
	return execSql(jobSql)
	.then(function (result) {
		if(result.length != 0) {
			result = result[0];
			return get_job_tasks_done(result.jobid)
			.then(function (result2) {
				result.already_done = result2;
				return result;
			})
		}
		else
			return null;
	})
}

function add_job(	memory, storage, threads, workers, budget, startprice, cpuprice, envprice, timeoutglobal, timeoutupload, timeoutrender, scene, format,
					startframe, stopframe, stepframe, outputdir, clientid, jobuuid, jobindex, walletaddress, whitelist, blacklist) {
  	return insert_parameters(	memory, storage, threads, workers, budget, startprice, cpuprice, envprice, timeoutglobal, timeoutupload, timeoutrender,
  								scene, format, startframe, stopframe, stepframe, outputdir, whitelist, blacklist)
	.then(function (result) {
		return insert_job(clientid, jobuuid, jobindex, walletaddress, result.insertId);
	})
}

function insert_parameters(	memory, storage, threads, workers, budget, startprice, cpuprice, envprice, timeoutglobal, timeoutupload, timeoutrender, scene,
							format, startframe, stopframe, stepframe, outputdir, whitelist, blacklist) {
	var sql = `INSERT INTO parameters (	memory, storage, threads, workers, budget, startprice, cpuprice, envprice, timeoutglobal, timeoutupload, timeoutrender, \
										scene, format, startframe,	stopframe, stepframe, outputdir, whitelist,	blacklist)										\																												\
										VALUES (${memory}, ${storage},	${threads}, ${workers},	${budget}, ${startprice}, ${cpuprice}, ${envprice},				\
												${timeoutglobal}, ${timeoutupload}, ${timeoutrender}, '${scene}', '${format}', ${startframe}, ${stopframe}, 	\
												${stepframe}, '${outputdir}', '${whitelist}', '${blacklist}')`;
	return execSql(sql)
	.then(function (result) {
		return result;
	})
}

function insert_job(clientid, jobuuid, jobindex, walletaddress, parametersid) {
	var timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
	var sql = `INSERT INTO jobs (	clientid, jobuuid, jobindex, walletaddress, parametersid, createdat, status, retrycount)									\
									VALUES (${clientid}, ${jobuuid}, '${jobindex}', '${walletaddress}', ${parametersid}, '${timestamp}', 'TODO', 0)`;
	return execSql(sql)
	.then(function (result) {
		return result;
	})
}

function insert_agreement(agreementid, jobid, providerid, providername) {
	var sql = `INSERT INTO agreements (	agreementid, jobid, providerid, providername, status) VALUES ('${agreementid}', ${jobid}, '${providerid}',				\
										'${providername}', 'CREATED')`;
	return execSql(sql)
	.then(function (result) {
		return result;
	})
}

function insert_task(jobid, frame, agreementid, createdat, rendertime, status) {
	var sql = `INSERT INTO tasks (  jobid, frame, agreementid, createdat, rendertime, status) VALUES (${jobid}, ${frame}, '${agreementid}', '${createdat}',		\
									${rendertime}, '${status}')`;
	return execSql(sql)
	.then(function (result) {
		return result;
	})
}

function insert_error(time, error, agreementid, jobid, providerid) {
	var sql = `INSERT INTO errors (	time, error, agreementid, jobid, providerid) VALUES ('${time}', '${error}', '${agreementid}', ${jobid}, '${providerid}')`;
	console.log('insert_error', error);
	//return execSql(sql)
	//.then(function (result) {
	//	return result;
	//})
}

function check_index(table, index) {
	var sql = `SELECT COUNT(1) indexExists FROM INFORMATION_SCHEMA.STATISTICS WHERE table_schema='mydb' AND table_name='${table}' AND index_name='${index}'`;
	return execSql(sql)
	.then(function (result) {
		return result[0].indexExists;
	})
}

function execSql(sql) {
	sql = sql.replace(/\s+/g, ' ');
  	let p = new Promise(function (res, rej) {
	    connection.query(sql, function (err, result) {
	    	if(err)
	    		rej(err);
	    	else
	    		res(result);
	    });
	});
	return p;
}

function createTables() {
	var createJobsTable = 	`create table if not exists jobs(
								jobid BIGINT AUTO_INCREMENT primary key,
								clientid BIGINT,
								jobuuid BIGINT,
								jobindex TINYTEXT,
								walletaddress VARCHAR(42),
								parametersid BIGINT,
								createdat TIMESTAMP,
								startedat TIMESTAMP,
								finishedat TIMESTAMP,
								status ENUM('TODO', 'RUNNING', 'RETRY', 'DONE'),
								retrycount SMALLINT)`;

	var createParametersTable = 	`create table if not exists parameters(
										parametersid BIGINT AUTO_INCREMENT primary key,
										memory SMALLINT,
										storage SMALLINT,
										threads SMALLINT,
										workers SMALLINT,
										budget SMALLINT,
										startprice SMALLINT,
										cpuprice SMALLINT,
										envprice SMALLINT,
										timeoutglobal SMALLINT,
										timeoutupload SMALLINT,
										timeoutrender SMALLINT,
										scene TINYTEXT,
										format TINYTEXT,
										startframe INT,
										stopframe INT,
										stepframe INT,
										outputdir TINYTEXT,
										whitelist TEXT,
										blacklist TEXT)`;

	var createTasksTable = 	`create table if not exists tasks(
								taskid BIGINT AUTO_INCREMENT primary key,
		                        jobid BIGINT,
		                        frame INT,
								agreementid VARCHAR(66),
								createdat TIMESTAMP,
								rendertime INT,
		                        status ENUM('REDO', 'DONE'),
		                        foreign key (jobid) references jobs(jobid),
		                        foreign key (agreementid) references agreements(agreementid))`;

	var createAgreementsTable = `create table if not exists agreements(
									agreementid VARCHAR(66) primary key,
		                        	jobid BIGINT,
		                        	providerid VARCHAR(42),
		                        	providername TINYTEXT,
		                        	status ENUM('CREATED', 'CONFIRMED', 'REJECTED', 'TERMINATED'),
		                        	reason TINYTEXT,
		                        	deploymenttime INT,
		                        	uploadtime INT,
		                        	cost FLOAT,
		                        	foreign key (jobid) references jobs(jobid))`;

	var createErrorsTable = `create table if not exists errors(
									errorid BIGINT AUTO_INCREMENT primary key,
		                        	time TIMESTAMP,
		                        	error TEXT,
		                        	agreementid VARCHAR(66),
		                        	jobid BIGINT,
		                        	providerid VARCHAR(42),
		                        	foreign key (jobid) references jobs(jobid),
		                        	foreign key (agreementid) references agreements(agreementid))`;

	var createIndexWalletaddressOnJobsTable = `create index walletaddress on jobs(walletaddress)`;
	var createIndexFinishedatOnJobsTable = `create index finishedat on jobs(finishedat)`;
	var createIndexStatusOnJobsTable = `create index status on jobs(status)`;
	var createIndexProvideridOnAgreementsTable = `create index providerid on agreements(providerid)`;
	var createIndexProvideridOnErrorsTable = `create index providerid on errors(providerid)`;

	return execSql(createJobsTable)
	.then(function (result) {
		return execSql(createParametersTable);
	})
	.then(function (result) {
		return execSql(createAgreementsTable);
	})
	.then(function (result) {
		return execSql(createTasksTable);
	})
	.then(function (result) {
		return execSql(createErrorsTable);
	})
	.then(function (result) {
		return check_index('jobs', 'walletaddress')
		.then(function (already_exists) {
			if(!already_exists)
				return execSql(createIndexWalletaddressOnJobsTable);
			else
				return result;
		})
	})
	.then(function (result) {
		return check_index('jobs', 'finishedat')
		.then(function (already_exists) {
			if(!already_exists)
				return execSql(createIndexFinishedatOnJobsTable);
			else
				return result;
		})
	})
	.then(function (result) {
		return check_index('jobs', 'status')
		.then(function (already_exists) {
			if(!already_exists)
				return execSql(createIndexStatusOnJobsTable);
			else
				return result;
		})
	})
	.then(function (result) {
		return check_index('agreements', 'providerid')
		.then(function (already_exists) {
			if(!already_exists)
				return execSql(createIndexProvideridOnAgreementsTable);
			else
				return result;
		})
	})
	.then(function (result) {
		return check_index('errors', 'providerid')
		.then(function (already_exists) {
			if(!already_exists)
				return execSql(createIndexProvideridOnErrorsTable);
			else
				return result;
		})
	})
}

module.exports = {execSql, createTables, get_job_tasks_done, update_table_entry_by_id, monitoring_by_wallet, get_job, add_job, insert_parameters, insert_job, insert_agreement, insert_task, insert_error}