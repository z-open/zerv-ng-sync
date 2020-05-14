// ////////////////////////////////////////////
// Modules
// ////////////////////////////////////////////

// the main gulp reference
const gulp = require('gulp');

const babel = require('gulp-babel');

// deletes files used during build (https://www.npmjs.com/package/gulp-clean)
const clean = require('gulp-clean');

// combines files into a single destination file (https://github.com/wearefractal/gulp-concat)
const concat = require('gulp-concat');

// angular.js annotation for compression (https://www.npmjs.com/package/gulp-ng-annotate)
const annotate = require('gulp-ng-annotate');

// add an IIFE to each file () 
const iife = require('gulp-iife');

// karma server to run automated unit tests (http://karma-runner.github.io/0.13/index.html)
const Server = require('karma').Server;

// gulp-bump (https://www.npmjs.com/package/gulp-bump)
const bump = require('gulp-bump');

// git-describe (https://www.npmjs.com/package/git-describe)
const { gitDescribeSync } = require('git-describe');

// ////////////////////////////////////////////
// Variables
// ////////////////////////////////////////////

// All application JS files.
const appFiles = [
    'src/**/*.js'
];

const mockFiles = [
    'test/helpers/**/*.js'
];

// ////////////////////////////////////////////
// Tasks
// ////////////////////////////////////////////

gulp.task('lib', () => {
    return gulp.src(appFiles)
        .pipe(iife({
            useStrict: true,
            trimCode: true,
            prependSemicolon: false,
            bindThis: false,
        }))
        .pipe(babel({
            presets: ['env'],
        }))
        .pipe(concat('zerv-ng-sync.js'))
        .pipe(annotate())
        .pipe(gulp.dest('dist/'));
});

gulp.task('mockLib', () => {
    return gulp.src(mockFiles)
        .pipe(iife({
            useStrict: true,
            trimCode: true,
            prependSemicolon: false,
            bindThis: false,
        }))
        .pipe(concat('zerv-ng-sync-mock.js'))
        .pipe(annotate())
        .pipe(gulp.dest('dist/'));
});

// single run testing
gulp.task('test', (done) => {
    new Server({configFile: __dirname + '/karma.conf.js', singleRun: true}, (code) => {
        if (code == 1) {
            console.log('Unit Test failures, exiting process');
            // done(new Error(`Karma exited with status code ${code}`));
            return process.exit(code);
        } else {
            console.log('Unit Tests passed');
            done();
        }
    }).start();
});

// continuous testing
gulp.task('tdd', (done) => {
    new Server({configFile: __dirname + '/karma.conf.js'}, () => {
        done();
    }).start();
});

// clean up files after builds
gulp.task('cleanup', () => {
    return gulp.src('dist', {read: false})
        .pipe(clean());
});

// bump the dev version (NOTE: NOT IN USE RIGHT NOW)
gulp.task('bump-dev', () => {
    const gitInfo = gitDescribeSync(__dirname);

    return gulp.src(['./package.json'])
        .pipe(bump({type: 'prerelease', preid: gitInfo.hash}))
        .pipe(gulp.dest('./'));
});

// build angular-socketio.js for dev (with map) and prod (min)
gulp.task('build', gulp.series('lib', 'mockLib', () => {
    return gulp.series('test', 'cleanup')();
}));


// continuous watchers
gulp.task('default', gulp.series('lib', () => {
    return gulp.series('tdd')();
}));
