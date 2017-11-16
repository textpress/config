"use strict";
const gulp = require( "gulp" );
const babel = require( "gulp-babel" );
const clean = require( "gulp-clean" );
const sourcemaps = require( "gulp-sourcemaps" );

const buildFolder = "lib";

require( "@textpress/gulp-bump-version" ).registerTask();

gulp.task( "build", [ "copy", "babel" ] );

gulp.task( "clean", () => {
    return gulp.src( [ buildFolder ], { read: false } )
        .pipe( clean() );
} );

gulp.task( "copy", [ "clean" ], () => {
    return gulp.src( [ "src/**/*", "!**/*.js", "!**/__tests__", "!**/__tests__/**" ] )
        .pipe( gulp.dest( buildFolder ) );
} );

gulp.task( "babel", [ "clean" ], () => {
    return gulp.src( [ "src/**/*.js", "!**/__tests__", "!**/__tests__/**" ] )
        .pipe( sourcemaps.init() )
        .pipe( babel() )
        .pipe( sourcemaps.write( "." ) )
        .pipe( gulp.dest( buildFolder ) );
} );
