#!/usr/bin/env node

var fs = require('fs'),
	sys = require('sys'),
	childProcess = require('child_process'),
	path = require('path'),
	spawn = childProcess.spawn,
	meta = JSON.parse(fs.readFileSync(__dirname + '/package.json')),
	exec = childProcess.exec,
	flag = './.monitor',
	nodeArgs = process.ARGV.splice(2),
	// removes 'node' and this script
	app = nodeArgs[0],
	owd = process.cwd(),
	node = null,
	monitor = null,
	timeout = 1000,
	// check every 1 second
	restartDelay = 0,
	// controlled through arg --delay 10 (for 10 seconds)
	restartTimer = null,
	// create once, reuse as needed
	reEscComments = /\\#/g,
	reUnescapeComments = /\^\^/g,
	// note that '^^' is used in place of escaped comments
	reComments = /#.*$/,
	reTrim = /^(\s|\u00A0)+|(\s|\u00A0)+$/g,
	reEscapeChars = /[.|\-[\]()\\]/g,
	reAsterisk = /\*/g,
	runners = {
		'.coffee': 'coffee',
		'.py': 'python',
		'.js': 'node'
	};

function startNode() {
	invokeTimeout = null;
	sys.log('\x1B[80S\x1B[2J\x1B[;H\x1B[32m[autotest] running tests\x1B[0m');

	var args = nodeArgs.slice(0);
	args[0] = app;
	var ext = path.extname(app);
	runner = runners[ext];
	node = spawn(runner, args);

	node.stdout.on('data', function (data) {
		sys.print(data);
	});

	node.stderr.on('data', function (data) {
		sys.error(data);
	});

	node.on('exit', function (code, signal) {
		// We expect the test run to end, so do this gracefully.
		node = null;
		return;
	});
}

function startMonitor() {
	var ext = path.extname(app);
	var cmd = 'find ' + owd + ' -name \"*' + ext + '\" -type f -newer ' + flag + ' -print';

	exec(cmd, function (error, stdout, stderr) {
		var files = stdout.split(/\n/);

		files.pop(); // remove blank line ending and split
		if (files.length) {
			fs.writeFileSync(flag, '');

			if (files.length) {
				if (restartTimer !== null) clearTimeout(restartTimer);

				restartTimer = setTimeout(function () {
					sys.log('[autotest] restarting due to changes...');
					files.forEach(function (file) {
						sys.log('[autotest] ' + file);
					});
					sys.print('\n\n');

					if (node !== null) {
						node.kill('SIGUSR2');
					} else {
						startNode();
					}
				}, restartDelay);
			}
		}

		setTimeout(startMonitor, timeout);
	});
}

function usage() {
	sys.print('usage: autotest [--debug] [your node app]\ne.g.: autotest ./server.js\nFor details see http://github.com/realistschuckle/autotest/\n\n');
}

function controlArg(nodeArgs, label, fn) {
	var i;

	if ((i = nodeArgs.indexOf(label)) !== -1) {
		fn(nodeArgs[i], i);
	} else if ((i = nodeArgs.indexOf('-' + label.substr(1))) !== -1) {
		fn(nodeArgs[i], i);
	} else if ((i = nodeArgs.indexOf('--' + label)) !== -1) {
		fn(nodeArgs[i], i);
	}
}

// attempt to shutdown the wrapped node instance and remove
// the monitor file as autotest exists


function cleanup() {
	if (invokeTimeout) {
		clearTimeout(invokeTimeout);
		invokeTimeout = null;
	}
	node && node.kill();
	fs.unlink(flag);
}

// control arguments test for "help" or "--help" or "-h", run the callback and exit
controlArg(nodeArgs, 'help', function () {
	usage();
	process.exit();
});

controlArg(nodeArgs, 'version', function () {
	sys.print('v' + meta.version + '\n');
	process.exit();
});

// look for delay flag
controlArg(nodeArgs, 'delay', function (arg, i) {
	var delay = nodeArgs[i + 1];
	nodeArgs.splice(i, 2); // remove the delay from the arguments
	if (delay) {
		sys.log('[autotest] Adding delay of ' + delay + ' seconds');
		restartDelay = delay * 1000; // in seconds
	}
});

controlArg(nodeArgs, '--debug', function (arg, i) {
	nodeArgs.splice(i, 1);
	app = nodeArgs[0];
	nodeArgs.unshift('--debug'); // put it at the front
});

if (!nodeArgs.length || !path.existsSync(app)) {
	// try to get the app from the package.json
	// doing a try/catch because we can't use the path.exist callback pattern
	// or we could, but the code would get messy, so this will do exactly 
	// what we're after - if the file doesn't exist, it'll throw.
	try {
		app = JSON.parse(fs.readFileSync('./package.json').toString()).scripts.test;

		if (nodeArgs[0] == '--debug') {
			nodeArgs.splice(1, 0, app);
		} else {
			nodeArgs.unshift(app);
		}
	} catch (e) {
		// no app found to run - so give them a tip and get the feck out
		usage();
		process.exit();
	}
}

sys.log('[autotest] v' + meta.version);

if(app.indexOf('node') == 0) {
    app = app.slice(4).trim();
}

// Change to application dir
process.chdir(path.dirname(app));
app = path.basename(app);
sys.log('[autotest] running ' + app + ' in ' + process.cwd());

startNode();

setTimeout(startMonitor, timeout);

// this little bit of hoop jumping is because sometimes the file can't be
// touched properly, and it send autotest in to a loop of restarting.
// this way, the .monitor file is removed entirely, and recreated with 
// permissions that anyone can remove it later (i.e. if you run as root
// by accident and then try again later).
if (path.existsSync(flag)) fs.unlinkSync(flag);
fs.writeFileSync(flag, '');
fs.chmodSync(flag, '666');

// remove the flag file on exit
process.on('exit', function (code) {
	cleanup();
	sys.log('[autotest] exiting');
});

var invokeTimeout = null;
// usual suspect: ctrl+c exit
process.on('SIGINT', function () {
	if (invokeTimeout) {
		cleanup();
		process.exit(0);
	}
	sys.log('Press CTRL+C again to exit...')
	invokeTimeout = setTimeout(startNode, 2000);
});

// on exception *inside* autotest, shutdown wrapped node app
process.on('uncaughtException', function (err) {
	sys.log('[autotest] exception in autotest killing node');
	sys.error(err.stack);
	cleanup();
});