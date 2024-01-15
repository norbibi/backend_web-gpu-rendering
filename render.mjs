import { TaskExecutor, Events } from "@golem-sdk/golem-js";
import { spawn } from 'node:child_process';
import util from 'util';

const SUBNET_TAG = 'publllc';		// process.env['SUBNET_TAG']
const PAYMENT_DRIVER = 'erc20';		// process.env['PAYMENT_DRIVER']
const PAYMENT_NETWORK = 'goerli';	// process.env['PAYMENT_NETWORK'];

// Norbert's GPU providers (Beta)
var whitelist_by_id = ["0x8610b20941308fd71a8c96559cf4f87a8a38f5b4", "0xdb17f52f24e213c617381235b6c1a2c577eb8558", "0xcc9a418a2a604f889f46440c74577ffdb8b3e22c"];
var blacklist_by_id = [];

const myFilter = async (proposal) => {
	var decision = false;

	var cpuprice = proposal.properties['golem.com.pricing.model.linear.coeffs'][0]*3600*1000;
	var envprice = proposal.properties['golem.com.pricing.model.linear.coeffs'][1]*3600*1000;
	var startprice = proposal.properties['golem.com.pricing.model.linear.coeffs'][2]*1000;

	if(	(cpuprice <= cpu_price) &&
		(envprice <= env_price) &&
		(startprice <= start_price) &&
		((whitelist_by_id.includes(proposal.provider.id) && whitelist_by_id.length != 0) || (whitelist_by_id.length == 0)) &&
		!blacklist_by_id.includes(proposal.provider.id))
		decision = true;

	return decision;
};

function queue_send(queue, message) {
	if(queue != null)
		queue.send(message);
	else
		console.log(message);
}

function check_yagna_status(queue) {
		var cmd = spawn('yagna', ['payment', 'status', '--json']);
		cmd.stdout.on('data', (data) => {
			var jsondata = JSON.parse(data.toString().replace("\n", ""));
			var account_amount = jsondata.amount;
			var account_reserved = jsondata.reserved;
	        if((account_amount - account_reserved) < 1) {
	            if(account_reserved > 0)
	                queue_send(queue, {event: 'YAGNA_ERROR', errorMessage: 'Yagna daemon has not enough glm available'});
	            else
	                queue_send(queue, {event: 'YAGNA_ERROR', errorMessage: 'Yagna daemon has below 1 GLM'});
			}
			else
				queue_send(queue, {event: 'YAGNA_OK'});
		});
}

var cpu_price = 0;
var env_price = 0;
var start_price = 0;

var deployments_time = {};

export async function render(   queue,
								memory,
								storage,
								threads,
								workers,
								budget,
								startPrice,
								cpuPrice,
								envPrice,
								timeoutGlobal,
								timeoutUpload,
								timeoutRender,
								scene,
								format,
								frames,
								outputDir,
								whitelist,
								blacklist,
								verbose
								) {

	check_yagna_status(queue);

	cpu_price = cpuPrice;
	env_price = envPrice;
	start_price = startPrice;

	if(blacklist.length != 0)
		blacklist_by_id = blacklist;

	if(whitelist.length != 0)
		whitelist_by_id = whitelist;

	if(format in ["OPEN_EXR_MULTILAYER", "OPEN_EXR"])
        var ext = "exr";
    else
        var ext = format.toLowerCase();

	var myEventTarget = new EventTarget();
	myEventTarget.addEventListener("GolemEvent", (e) => {

		if(e.name == 'AgreementCreated')
			queue_send(queue, {event: 'AGREEMENT_CREATED', agreementId: e.detail.id, providerId: e.detail.providerId, providerName: e.detail.providerName});
		else if(e.name == 'AgreementConfirmed')
		{
			deployments_time[e.detail.id] = Date.now();
			queue_send(queue, {event: 'AGREEMENT_CONFIRMED', agreementId: e.detail.id});
		}
		else if(e.name == 'AgreementRejected')
			queue_send(queue, {event: 'AGREEMENT_REJECTED', agreementId: e.detail.id, providerId: e.detail.providerId, reason: e.detail.reason});
		else if(e.name == 'AgreementTerminated')
			queue_send(queue, {event: 'AGREEMENT_TERMINATED', agreementId: e.detail.id, providerId: e.detail.providerId, reason: e.detail.reason});
		else if(e.name == 'InvoiceReceived')
			queue_send(queue, {event: 'INVOICE_RECEIVED', agreementId: e.detail.agreementId, providerId: e.detail.providerId, amount: e.detail.amount, time: e.detail.timestamp});
	});

	const executor = await TaskExecutor.create({
		expirationSec: timeoutGlobal * 60,
		yagnaOptions: {apiKey: process.env.YAGNA_APPKEY},
		subnetTag: SUBNET_TAG,
		payment: {driver: PAYMENT_DRIVER, network: PAYMENT_NETWORK},
		package: "b5e19a68e0268c0e72309048b5e6a29512e3ecbabd355c6ac590f75d",
		proposalFilter: myFilter,
		minMemGib : memory,
		minStorageGib: storage,
		minCpuThreads: threads,	// minCpuCores
		capabilities: ["!exp:gpu"],
		engine: "vm-nvidia",
		logLevel: "debug",
		eventTarget: myEventTarget
	});

	var cmd_display = "PCIID=$(nvidia-xconfig --query-gpu-info | grep 'PCI BusID' | awk -F'PCI BusID : ' '{print $2}') && (nvidia-xconfig --busid=$PCIID --use-display-device=none --virtual=1280x1024 || true) && ((Xorg :1 &) || true) && sleep 5"

	try {
		executor.onActivityReady(async (ctx) => {
			var dt = Date.now() - deployments_time[ctx.activity.agreementId];
			queue_send(queue, {agreementId: ctx.activity.agreementId, event: 'DEPLOYMENT_FINISHED', deployment_time: dt});
			const res = await ctx
				.beginBatch()
				.uploadFile(scene, "/golem/resources/scene.blend")
				.run(cmd_display)
				.end()
				.catch((e) => {
					//blacklist_by_id.push(ctx.options.provider.id);
					queue_send(queue, {agreementId: ctx.activity.agreementId, event: 'UPLOAD_ERROR', error_message: e});
				});

			var upload_time = Date.parse(res[1].eventDate) - Date.parse(res[0].eventDate)
			queue_send(queue, {agreementId: ctx.activity.agreementId, event: 'UPLOAD_FINISHED', upload_time: upload_time});
		});

		const futureResults = frames.map((frame) => executor.run(async (ctx) => {
			var filename = frame.toString().padStart(4, "0");
			var output_file = `${outputDir}/${filename}.${ext}`
			var cmd_render = `(DISPLAY=:1 blender -b /golem/resources/scene.blend -o /golem/output/ -noaudio -F ${format} -f ${frame.toString()} -- --cycles-device CUDA)`

			const result = await ctx
				.beginBatch()
				.run(cmd_render)
				.downloadFile(`/golem/output/${filename}.${ext}`, output_file)
				.end()
				.catch((e) => {
					//blacklist_by_id.push(ctx.options.provider.id);
					queue_send(queue, {agreementId: ctx.activity.agreement.id, event: 'RENDER_FRAME_ERROR', error_message: e});
				});

			var start_render_time = Date.parse(result[0].eventDate);
			var render_frame_time = Date.parse(result[1].eventDate) - start_render_time;

			queue_send(queue, {agreementId: ctx.activity.agreement.id, event: 'RENDER_FRAME_FINISHED', frame: frame, startRenderTime: start_render_time, renderFrameTime: render_frame_time, outputFile: output_file});
		}));

		const results = await Promise.all(futureResults);
	} catch (error) {
		console.error("Computation failed:", error);
	} finally {
		await executor.shutdown();
	}
}