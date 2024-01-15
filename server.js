require("./global.js");
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fileUpload = require("express-fileupload");
const mysql = require('mysql2');
const sanitizer = require("perfect-express-sanitizer");
const { Validator } = require('node-input-validator');
const { ethers } = require("ethers");
const niv = require('node-input-validator');
const event = require("./event.js");
const worker = require("./worker.js");

utils.check_yagna();

const app = express();

app.use(cors({origin: '*'}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(fileUpload());
app.use(
	sanitizer.clean({
    	xss: true,
    	sql: true
    })
);

const PORT = 3001;

var mutex_job = false;
var mutex_queue = false;

connection = mysql.createConnection({
	host     : process.env['HOST_BACKEND'],
	user     : 'user',
	password : 'userpassword',
	database : 'mydb'
});

connection.connect(function(err)
{
	if(err) {
		console.log(err);
		process.exit(-5);
	}

  	db.createTables()
  	.then(function (result) {
		console.log('db tables ready');

		app.listen(PORT, () => {
			console.log(`Events service listening at http://localhost:${PORT}`)
		})

		function eventsHandler(request, response, next) {
			const headers = {
				'Content-Type': 'text/event-stream',
				'Connection': 'keep-alive',
				'Cache-Control': 'no-cache'
			};

			response.writeHead(200, headers);
			const clientId = Date.now();
			response.write(`data: {"event": "CONNECTED", "clientId": ${clientId}}\n\n`);

			const newClient = {
				id: clientId,
				walletaddress: null,
				authenticated: false,
				response
			};

			clients.push(newClient);

			request.on('close', () => {
				console.log(`${clientId} Connection closed`);
				clients = clients.filter(client => client.id != clientId);
			});
		}

		app.get('/connect', eventsHandler);

		app.get("/authenticate", (req, res) => {
			var walletaddress = req.query.walletaddress.toLowerCase();
			addressThatSignedData = ethers.verifyMessage(req.query.clientid, req.query.signedclientid);
			if(addressThatSignedData.toLowerCase() == walletaddress) {
				var client = utils.get_client(clients, Number(req.query.clientid));
				client.authenticated = true;
				client.walletaddress = walletaddress;
				res.status(200).send('ok');
				db.monitoring_by_wallet(walletaddress)
				.then(function (jobs_status) {
					utils.send_event_to_client(client, {event: 'SYNC', all_status: jobs_status});
				});
			}
			else {
				res.status(422).send('error');
			}
		});

		app.get("/download", (req, res) => {
			const download_validator = new Validator(req.query, {
				filename: 'required|string'
			});

			download_validator.check().then((matched) => {
				if (!matched)
					res.status(422);
				else
					res.status(200).download(`inputs/${atob(req.query.filename)}`);
			});
		});

		app.post("/upload", function (req, res) {
			const upload_validator = new Validator(req, {
		    	'files.fileField': 'required|object',
		    	'req.body.params': 'required|string'
			});

			upload_validator.check().then((matched) => {
				if (!matched)
					res.status(422);
				else
				{
					niv.extend('format', ({ value }) => {
						if(["PNG", "BMP", "JPEG", "OPEN_EXR_MULTILAYER", "OPEN_EXR"].includes(value))
							return true;
						return false;
					});

					try {
						var ns_params = JSON.parse(atob(req.body.params));
						var params = sanitizer.sanitize.prepareSanitize(
						  ns_params,
						  {sql: true, level: 5}
						);

						const params_validator = new niv.Validator(params, {
							clientid: 'required|integer',
				        	walletaddress: 'string',
					        memory: 'required|integer',
					        storage: 'required|integer',
					        threads: 'required|integer',
					        workers: 'required|integer',
					        budget: 'required|integer',
					        startprice: 'required|integer',
					        cpuprice: 'required|integer',
					        envprice: 'required|integer',
					        timeoutglobal: 'required|integer',
					        timeoutupload: 'required|integer',
					        timeoutrender: 'required|integer',
					        format: 'required|format',
					        startframe: 'required|integer',
					        stopframe: 'required|integer',
					        stepframe: 'required|integer',
					        whitelist: 'array',
					        'whitelist.*': 'required|string',
					        blacklist: 'array',
					        'blacklist.*': 'required|string',
					        idx: 'required|string'
						});

						params_validator.check().then((matched) => {
							if (!matched){
								res.status(422);
							}
							else
							{
								client = utils.get_client(clients, params.clientid);
								if(client.authenticated)
								{
									var jobuuid = Date.now();
									var scene = req.files.fileField.name.split(' ').join('_');
									var outputdir = `${__dirname}/inputs/${params.clientid}/${jobuuid}`;

									var remaining_providers_id = params.whitelist.filter(providerid => !params.blacklist.includes(providerid));

									if((params.whitelist.length != 0) && (remaining_providers_id.length == 0))
										utils.send_event_to_wallet_clients(client.walletaddress, {event: 'WHITE_BLACK_LIST_ERROR', errorMessage: 'incompatible white/black-lists', jobIndex: params.idx});

									fs.mkdir(outputdir, { recursive: true }, function(err) {
										if(err) {
											console.log(err);
											res.status(422);
											utils.send_event_to_wallet_clients(client.walletaddress, {event: 'INTERNAL_ERROR_1', errorMessage: 'internal error 1', jobIndex: params.idx});
											db.insert_error(utils.get_mysql_date(), err, '', '', '');
										}
										else {
											fs.writeFile(`${outputdir}/${scene}`, req.files.fileField.data, function(err) {
										    	if(err) {
										    		console.log(err);
										    		res.status(422);
													utils.send_event_to_wallet_clients(client.walletaddress, {event: 'INTERNAL_ERROR_2', errorMessage: 'internal error 2', jobIndex: params.idx});
													db.insert_error(utils.get_mysql_date(), err, '', '', '');
										    	}
										    	else {
										    		var cmd = spawn('blender', ['-b', `${outputdir}/${scene}`, '--python', './get_blend_infos.py']);
													cmd.stdout.on('data', (data) => {
														var sdatas = data.toString().split("\n");
														for(sdata of sdatas) {
															if(sdata.includes('Error')) {
																res.status(422);
																utils.send_event_to_wallet_clients(client.walletaddress, {event: 'INVALID_BLEND_FILE', errorMessage: 'invalid blender file', jobIndex: params.idx});
															}
															else
															{
																try {
																	var sdata2 = sdata.trim().replaceAll("'", '"');
																	var jsondata = JSON.parse(sdata2);

																	if((params.startframe < jsondata.start) || (params.startframe > jsondata.end))
																		utils.send_event_to_wallet_clients(client.walletaddress, {event: 'START_FRAME_ERROR', errorMessage: `start frame must be between ${jsondata.start} and ${jsondata.end}`, jobIndex: params.idx});
																	else if((params.stopframe < jsondata.start) || (params.stopframe > jsondata.end))
																		utils.send_event_to_wallet_clients(client.walletaddress, {event: 'STOP_FRAME_ERROR', errorMessage: `stop frame must be between ${jsondata.start} and ${jsondata.end}`, jobIndex: params.idx});
																	else if(params.stopframe < params.startframe)
																		utils.send_event_to_wallet_clients(client.walletaddress, {event: 'START_STOP_FRAME_ERROR', errorMessage: 'start frame must be < stop frame', jobIndex: params.idx});
																	else {
																		db.add_job(	params.memory, params.storage, params.threads, params.workers, params.budget, params.startprice, params.cpuprice, params.envprice,
																					params.timeoutglobal, params.timeoutupload, params.timeoutrender, scene, params.format, params.startframe, params.stopframe, params.stepframe,
																					outputdir, params.clientid, jobuuid, params.idx, params.walletaddress, JSON.stringify(params.whitelist), JSON.stringify(params.blacklist))
																		.then(function (jobs_status) {
																			res.status(200);
																			utils.send_jobs_status_to_wallet_clients(client.walletaddress);
																		});
																	}

																} catch (error) {}
															}
														}
													});
										    	}
											});
										}
									})
								}

							}
						});
					}
					catch {
						res.status(422);
					}
				}
			});
		});

		var interval = setInterval(worker_func, 1000);
		var interval2 = setInterval(event_func, 1000);
	})
	.catch((err) => {
		console.log(err);
		process.exit(-6);
  	})
});

function worker_func() {
	if(!mutex_job)
	{
		mutex_job = true;
		worker.checkJobs()
		.then(function (result) {
			mutex_job = false;
		});
	}
}

function event_func() {
	if(!mutex_queue)
	{
		mutex_queue = true;
		event.checkQueue();
		mutex_queue = false;
	}
}