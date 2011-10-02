# autotest

For use during development of a node.js or python based application. 

`autotest` will watch all the files in the directory in which you started `autotest`. If any change, it will automatically rerun your tests.

The entry point of your test suite can be specified in the `package.json` file: 
```javascript
{
	...
	'scripts' : {
		'test' : 'test/index.js'
    }
    ...
}
```

`autotest --npm` will behave as if you ran `npm test` in the directory where you have your `package.json`. This enables you to use a test framework such as [expresso](http://visionmedia.github.com/expresso/), which provides automatic test discovery.


# Installation

Either through forking or by using [npm](http://npmjs.org) (the recommended way):

    npm install autotest -g
    
And `autotest` will be installed in to your bin path. Note that as of npm v1, you must explicitly tell npm to install globally as `autotest` is a command line utility.

