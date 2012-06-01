#!/usr/bin/env node

var fs = require('fs'),
	util = require('util'),
	childProcess = require('child_process'),
	path = require('path'),
	colors = require('colors'),
	spawn = childProcess.spawn,
	meta = JSON.parse(fs.readFileSync(__dirname + '/package.json')),
	exec = childProcess.exec,
	flag = './.monitor',
	nodeArgs = process.argv.splice(2),
	// removes 'node' and this script
	app = nodeArgs[0],
	// process.cwd sometimes changes to the location of autotest.js or .../bin/autotest
	pwd = process.env['PWD'],
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
	runNpmTest = false,
	ignoreFiles = [],
	runners = {
		'.coffee': 'coffee',
		'.py': 'python',
		'.js': 'node'
	};

function log(what, prefix) {
	var pfx = typeof (prefix) === 'undefined' || prefix === null ? '' : prefix;
	util.log(pfx + '[autotest] '.green + what);
}

function startTests() {
	invokeTimeout = null;
	var prefix = '\x1B[80S\x1B[2J\x1B[;H'; // clear the screen
	log('running tests'.green.bold, prefix);

	run = getRunnerAndArgs();
	// util.debug('[autotest] running ' + run.runner + ' with args: ' + run.args.join(' ') + ' in ' + pwd);
	// in case of npm link or even starting with ./node_modules/.bin/autotest
	// cwd gets confused and the process would think /usr/local/... or .../.bin/ is
	// the current directory.
	// $END{PWD} is not very portable, but neither is the version of find we are using.
	if (process.cwd() !== pwd)
		process.chdir(pwd);
	node = spawn(run.runner, run.args);

	node.stdout.on('data', function (data) {
		util.print(data);
	});

	node.stderr.on('data', function (data) {
		util.error(data);
	});

	node.on('exit', function (code, signal) {
		// We expect the test run to end, so do this gracefully.
		node = null;
		return;
	});
}

function getRunnerAndArgs() {
	if (runNpmTest) {
		return { 'runner' : 'npm', 'args' : 'test --loglevel silent'.split(' ') };
	}

	var args = nodeArgs.slice(0);
	args[0] = app;
	var ext = path.extname(app);
	var runner = runners[ext];
	return { 'runner' : runner, 'args' : args };

}

function startMonitor() {
	var ext = path.extname(app);
	var ignore = [];
	for(var i = 0; i < ignoreFiles.length; i++) {
		ignore.push(' -iname "' + ignoreFiles[i] + '"'); // TODO: better command line params
	}
	var cmd = 'find ' + pwd + ' -name \"*' + ext + '\" -type f -newer ' + flag
		+ (ignore.length > 0 ? ' -not \\( ' + ignore.join(' -or ') + ' \\)' : '')
		+ ' -print';
	//log(cmd);

	exec(cmd, function (error, stdout, stderr) {
		var files = stdout.split(/\n/);

		files.pop(); // remove blank line ending and split
		if (files.length) {
			fs.writeFileSync(flag, '');

			if (files.length) {
				if (restartTimer !== null) clearTimeout(restartTimer);

				restartTimer = setTimeout(function () {
					log('restarting due to changes...');
					files.forEach(function (file) {
						log((file + '').underline);
					});
					util.print('\n\n');

					if (node !== null) {
						node.kill('SIGUSR2');
					} else {
						startTests();
					}
				}, restartDelay);
			}
		}

		setTimeout(startMonitor, timeout);
	});
}

function usage() {
	util.print('usage: autotest [--debug] [your node app]\ne.g.: autotest ./server.js\nFor details see http://github.com/realistschuckle/autotest/\n\n');
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
	util.print('v' + meta.version + '\n');
	process.exit();
});

// look for delay flag
controlArg(nodeArgs, 'delay', function (arg, i) {
	var delay = nodeArgs[i + 1];
	nodeArgs.splice(i, 2); // remove the delay from the arguments
	if (delay) {
		log('Adding delay of ' + colors.bold(delay) + ' seconds');
		restartDelay = delay * 1000; // in seconds
	}
});

controlArg(nodeArgs, '--debug', function (arg, i) {
	nodeArgs.splice(i, 1);
	app = nodeArgs[0];
	nodeArgs.unshift('--debug'); // put it at the front
});

controlArg(nodeArgs, '--npm', function (arg, i) {
	nodeArgs.splice(i,1);
	runNpmTest = true;
	log('Running tests using ' + colors.bold("npm test"));
});

controlArg(nodeArgs, '--ignore', function (arg, i) {
	nodeArgs.splice(i, 1); // removing the --ignore
	var filePattern = nodeArgs.splice(i, 1).toString();
	ignoreFiles = filePattern.split('|');
	log('Ignoring files matching: ' + ignoreFiles.join(', '));
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

log('v' + meta.version);

if(app.indexOf('node') == 0) {
    app = app.slice(4).trim();
}

// Change to application dir
process.chdir(path.dirname(app));
app = path.basename(app);
log('running ' + app + ' in ' + process.cwd());

startTests();

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
	log('exiting'.red);
});

var invokeTimeout = null;
// usual suspect: ctrl+c exit
process.on('SIGINT', function () {
	if (invokeTimeout) {
		cleanup();
		process.exit(0);
	}
	log('Press CTRL+C again to exit...'.red.bold)
	invokeTimeout = setTimeout(startTests, 2000);
});

// on exception *inside* autotest, shutdown wrapped node app
process.on('uncaughtException', function (err) {
	log('exception in autotest killing node'.red.bold);
	util.error(err.stack);
	cleanup();
});
