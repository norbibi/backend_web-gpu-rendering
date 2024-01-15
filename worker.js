require("./global.js");

async function render(	memory, storage, threads, workers,	budget,	startPrice,	cpuPrice, envPrice, timeoutGlobal, timeoutUpload, timeoutRender, scene, format,
						frames, outputDir, whitelist, blacklist, verbose) {
	const ggr = await import("./render.mjs");
	return ggr.render(	queue, memory, storage, threads, workers, budget, startPrice, cpuPrice, envPrice, timeoutGlobal, timeoutUpload, timeoutRender, scene, format,
						frames, outputDir, whitelist, blacklist, verbose);
}

function assemble_frames_and_notify(walletaddress, scene_filepath, archive_name, output_dir, clientid, jobuuid, jobindex) {
	var cmd = spawn('blender', ['-b', `${scene_filepath}`, '--python', './assemble_frames.py']);
	cmd.on('close', (code) => {
		child_process.execSync(`zip -r ${archive_name} *`, {
		  cwd: output_dir
		});
		utils.send_event_to_wallet_clients(walletaddress, {"event": "JOB_FINISHED", "clientId": clientid, "jobUuid": jobuuid, "jobIndex": jobindex});
	});

	cmd.stdout.on('data', (data) => {
		console.log('stdout', data.toString());
	});

	cmd.stderr.on('data', (data) => {
		console.log('stderr', data.toString());
	});

	cmd.on('error', (code) => {
		console.log('error', code);
	});
}

function do_post_job_actions(jobid, walletaddress, scene_filepath, archive_name, output_dir, clientid, jobuuid, jobindex) {
	var endJobDate = utils.get_mysql_date();
	db.update_table_entry_by_id('jobs', 'jobid', jobid, {finishedat: endJobDate, status: 'DONE'})
	.then(function (result) {
		assemble_frames_and_notify(walletaddress, scene_filepath, archive_name, output_dir, clientid, jobuuid, jobindex);
	});
}

function checkJobs() {
	return db.get_job()
	.then(function (cj) {
		if(cj)
		{
			jobid = cj.jobid;
			walletaddress = cj.walletaddress;
			jobindex = cj.jobindex;
			scene = cj.scene;

			var frames = utils.range(cj.startframe, cj.stopframe + 1, cj.stepframe);
			var job_frames_len = frames.length;

			var sql_job_update = {status: 'RUNNING'};
			if(cj.status == 'TODO')
				sql_job_update.startedat = utils.get_mysql_date();
			else
				cj.already_done.forEach((frame_already_done) => frames = frames.filter(frame => frame !== frame_already_done));

			if(frames.length == 0)
				return do_post_job_actions(	jobid, cj.walletaddress, `${cj.outputdir}/${cj.scene}`, `${cj.clientid}_${cj.jobuuid}`,
											cj.outputdir, cj.clientid, cj.jobuuid, cj.jobindex);
			else
				return db.update_table_entry_by_id('jobs', 'jobid', cj.jobid, sql_job_update)
				.then(function (result) {
					utils.send_jobs_status_to_all_wallet_clients();
					return render( 	cj.memory, cj.storage, cj.threads, cj.workers, cj.budget, cj.startprice, cj.cpuprice, cj.envprice,	cj.timeoutglobal, cj.timeoutupload,
									cj.timeoutrender, `${cj.outputdir}/${cj.scene}`, cj.format, frames, cj.outputdir, JSON.parse(cj.whitelist), JSON.parse(cj.blacklist), "true")
					.then((data) => {
						return db.get_job_tasks_done(cj.jobid)
						.then(function (result) {
							if(result.length == job_frames_len)
								return do_post_job_actions(	jobid, cj.walletaddress, `${cj.outputdir}/${cj.scene}`, `${cj.clientid}_${cj.jobuuid}`,
															cj.outputdir, cj.clientid, cj.jobuuid, cj.jobindex);
							else
								return db.update_table_entry_by_id('jobs', 'jobid', cj.jobid, {status: 'RETRY', retrycount: cj.retrycount + 1});
						})
					})
					.catch((err) => {
						if(!err.toString().includes('No connection to Yagna'))
						{
							utils.send_event_to_wallet_clients(cj.walletaddress, {"event": "INTERNAL_ERROR_3", "errorMessage": err, "jobIndex": cj.jobindex});
							db.insert_error(utils.get_mysql_date(), err, '', cj.jobid, '');
						}
					});
				})
		}
		else
			return null;
	})
}

module.exports = {checkJobs}