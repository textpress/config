"use strict";
const gulp = require( "gulp" );
const babel = require( "gulp-babel" );
const clean = require( "gulp-clean" );
const rename = require( "gulp-rename" );
const sourcemaps = require( "gulp-sourcemaps" );
const merge = require( "merge-stream" );

const buildFolder = "lib";

require( "@textpress/gulp-bump-version" ).registerTask();

gulp.task( "build", [ "copy", "babel" ] );

gulp.task( "clean", () => {
    return gulp.src( [ buildFolder ], { read: false } )
        .pipe( clean() );
} );

gulp.task( "copy", [ "clean" ], () => {
    const miscFiles = gulp.src( [ "src/**/*", "!**/*.js", "!**/__tests__", "!**/__tests__/**" ] )
        .pipe( gulp.dest( buildFolder ) );

    const flowFiles = gulp.src( [ "src/**/*.js", "!**/__tests__", "!**/__tests__/**" ] )
        .pipe( rename( { extname: ".js.flow" } ) )
        .pipe( gulp.dest( buildFolder ) );

    return merge( miscFiles, flowFiles );
} );

gulp.task( "babel", [ "clean" ], () => {
    return gulp.src( [ "src/**/*.js", "!**/__tests__", "!**/__tests__/**" ] )
        .pipe( sourcemaps.init() )
        .pipe( babel() )
        .pipe( sourcemaps.write( "." ) )
        .pipe( gulp.dest( buildFolder ) );
} );
