require("./global.js");

function check_yagna() {
	if(process.env.YAGNA_APPKEY == undefined) {
		console.log('error, YAGNA_APPKEY is not defined');
		process.exit(-1);
	}
	else {
		var cmd = spawn('yagna', ['app-key', 'list', '--json']);
		cmd.stdout.on('data', (data) => {
			var jsondata = JSON.parse(data.toString().replace("\n", ""));
			keys = jsondata.map(key_entry => key_entry.key);
			if(!keys.includes(process.env.YAGNA_APPKEY)) {
				console.log('error, bad YAGNA_APPKEY');
				process.exit(-2);
			}
		});

		cmd.stderr.on('data', (data) => {
			var sdata = data.toString();
			if(sdata.includes("routing error: Connecting GSB")) {
				console.log('error, Yagna is not_running');
				process.exit(-3);
			}
		});

		cmd.on('error', (code) => {
			console.log('error, Yagna is not installed or not in PATH');
			process.exit(-4);
		});
	}
}

function get_mysql_date() {
	return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function get_mysql_date_m7d() {
	var date = new Date();
	date.setDate(date.getDate() - 7);
	return date.toISOString().slice(0, 19).replace('T', ' ');
}

function send_event_to_client(client, event) {
	if(client)
		client.response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function send_event_to_wallet_clients(walletaddress, event) {
	get_clients_by_wallet(clients, walletaddress).forEach((client) => {
		client.response.write(`data: ${JSON.stringify(event)}\n\n`);
	});
}

function send_jobs_status_to_all_wallet_clients() {
	clients.forEach((client) => {
		if(client.authenticated) {
			db.monitoring_by_wallet(client.walletaddress)
			.then(function (jobs_status) {
				send_event_to_wallet_clients(walletaddress, {event: 'SYNC', all_status: jobs_status});
			});
		}
	});
}

function send_jobs_status_to_wallet_clients(walletaddress) {
	db.monitoring_by_wallet(walletaddress)
	.then(function (jobs_status) {
		send_event_to_wallet_clients(walletaddress, {event: 'SYNC', all_status: jobs_status});
	});
}

function get_client(clients, clientid) {
	var client = clients.filter(obj => obj.id == clientid);
	if(client.length != 0)
		return client[0];
	else
		return null;
}

function get_clients_by_wallet(clients, walletaddress) {
	return clients.filter(obj => obj.walletaddress === walletaddress);
}

function range(start, stop, step) {
	var res = [];
	var i = start;
	while (i<stop) {
		res.push(i);
		i += step;
	}
	return res;
}

module.exports = {check_yagna, get_mysql_date, get_mysql_date_m7d, send_event_to_wallet_clients, send_jobs_status_to_all_wallet_clients, send_event_to_client, send_jobs_status_to_wallet_clients, get_client, range}