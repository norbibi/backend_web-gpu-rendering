require("./global.js");

function checkQueue() {
	var msg;
	try {
		while(msg = queue.receive()) {

			msg.scene = scene;
			msg.jobIndex = jobindex;

			if(!(['YAGNA_OK', 'YAGNA_ERROR', 'RENDER_FRAME_FINISHED', 'INVOICE_RECEIVED', 'RENDER_FRAME_ERROR'].includes(msg.event)))
				utils.send_event_to_wallet_clients(walletaddress, msg);

			if(msg.event === 'YAGNA_OK')
				yagna_already_in_error = false;
			else if(msg.event === 'YAGNA_ERROR')
			{
				if(!yagna_already_in_error)
				{
					yagna_already_in_error = true;
					db.insert_error(utils.get_mysql_date(), msg.errorMessage, '', jobid, '');
					utils.send_event_to_wallet_clients(walletaddress, msg);
					console.log(msg);
				}
			}
			else if(msg.event === 'RENDER_FRAME_FINISHED')
			{
				var frame_size = fs.statSync(msg.outputFile).size;
				if(frame_size != 0)
				{
					var createdat = utils.get_mysql_date();
					db.insert_task(jobid, msg.frame, msg.agreementId, createdat, msg.renderFrameTime, 'DONE');
					delete msg.outputFile;
					delete msg.startRenderTime;
					utils.send_event_to_wallet_clients(walletaddress, msg);
				}
			}
			else if(msg.event === 'RENDER_FRAME_ERROR')
			{
				var createdat = new Date(msg.startRenderTime).toISOString().slice(0, 19).replace('T', ' ');
				db.insert_task(jobid, msg.frame, msg.agreementId, createdat, 0, 'REDO');
			}
			else if(msg.event === 'AGREEMENT_CREATED')
				db.insert_agreement(msg.agreementId, jobid, msg.providerId, msg.providerName);
			else if(msg.event === 'AGREEMENT_CONFIRMED')
				db.update_table_entry_by_id('agreements', 'agreementid', msg.agreementId, {status: 'CONFIRMED'});
			else if(['AGREEMENT_REJECTED', 'AGREEMENT_TERMINATED'].includes(msg.event))
				db.update_table_entry_by_id('agreements', 'agreementid', msg.agreementId, {status: msg.event.split('_')[1], reason: msg.reason});
			else if(msg.event == 'INVOICE_RECEIVED')
			{
				db.update_table_entry_by_id('agreements', 'agreementid', msg.agreementId, {cost: msg.amount});
				delete msg.time;
				utils.send_event_to_wallet_clients(walletaddress, msg);
			}
			else if(msg.event == 'UPLOAD_FINISHED')
				db.update_table_entry_by_id('agreements', 'agreementid', msg.agreementId, {uploadtime: msg.upload_time});
			else if(msg.event == 'DEPLOYMENT_FINISHED')
				db.update_table_entry_by_id('agreements', 'agreementid', msg.agreementId, {deploymenttime: msg.deployment_time});
		}
	}
	catch {}
}

module.exports = {checkQueue}
