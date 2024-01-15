class Queue {

  constructor() { this.q = []; }
  send(item)  	{ this.q.push( item ); }
  receive()     { return this.q.shift(); }

}

global.fs = require("fs");
global.spawn = require("child_process").spawn;
global.child_process = require("child_process");

global.db = require("./db.js");
global.utils = require("./utils.js");

require('dotenv').config();

global.yagna_already_in_error = false;
global.queue = new Queue();
global.connection = null;
global.clients = [];
global.jobid = null;
global.walletaddress = null;
global.scene = null;
global.jobindex = null;