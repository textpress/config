"use strict";

import ConfigError from "./errors";
import minSchema from "./min-schema.json";

import AWS from "aws-sdk";
import convict from "convict";
import fs from "fs";
import _ from "lodash";
import path from "path";
import Immutable from "seamless-immutable";

function configDir() {
    return process.env.NODE_CONFIG_DIR || path.join( process.cwd(), "config" );
}

function configFileNames() {
    const deployment = process.env.NODE_ENV || "development";
    let result = [ deployment ];

    const fullHostName = process.env.HOST || process.env.HOSTNAME || require( "os" ).hostname() || "";
    if ( fullHostName ) {
        const shortHostName = fullHostName.substr( 0, fullHostName.indexOf( "." ) );
        if ( shortHostName )
            result = result.concat( [ shortHostName, `${shortHostName}-${deployment}` ] );
        result = result.concat( [ fullHostName, `${fullHostName}-${deployment}` ] );
    }

    return result;
}

function fileExist( path ) {
    try {
        return fs.statSync( path ).isFile();
    } catch ( x ) {}
    return false;
}

function loadConfigFile( root, name, required ) {
    name = `${name}.json`;
    const filePath = path.join( root, name );
    console.log( "Loading config file: ", filePath );
    try {
        if ( fileExist( filePath ) )
            return JSON.parse( fs.readFileSync( filePath, { encoding: "utf8" } ) );
        if ( !required )
            return {};
    } catch ( x ) {
        throw new ConfigError( `Cannot read config file: ${name}`, x )
    }
    throw new ConfigError( `Required config file doesn't exist: ${name}`, filePath );
}

function processParameter( stagePrefix, value, keyPath, result ) {
    if ( _.isString( value ) && value.startsWith( "@/" ) ) {
        result[ keyPath ] = `${stagePrefix}${value.substr( 1 )}`;
        return result;
    }
    if ( _.isObject( value ) )
        return extractRemoteParameters( stagePrefix, value, keyPath, result );
    return result;
}

export function extractRemoteParameters( stagePrefix, config, path = "", result = {} ) {
    const keyPath = _.isArray( config )
        ? ( key ) => `${path}[${key}]`
        : ( key ) => path ? `${path}.${key}` : `${key}`
    ;
    return _.reduce(
        config,
        ( result, value, key ) => processParameter( stagePrefix, value, keyPath( key ), result ),
        result
    );
}

export function findCommonRemoteParametersRoot( remoteParams ) {
    const rootParts = _.reduce(
        remoteParams,
        ( rootParts, value ) => {
            const valueParts = value.split( "/" );
            if ( !rootParts )
                return valueParts;
            const index = _.findIndex( rootParts, ( value, index ) => { return valueParts[ index ] !== value; } );
            if ( index === -1 )
                return rootParts;
            rootParts.splice( index );
            return rootParts;
        },
        null
    ) || [ "" ];
    const result = rootParts.join( "/" );
    return result || "/";
}

async function loadRemoteConfig( path, ssmConfig ) {
    const ssm = new AWS.SSM( ssmConfig );
    const getParametersByPath = Promise.promisify( ssm.getParametersByPath, { context: ssm } );
    const { Parameters } = await getParametersByPath( { Path: path, Recursive: true, WithDecryption: true } );
    return _.reduce(
        Parameters,
        ( result, parameter ) => {
            result[ parameter.Name ] = parameter.Value;
            return result;
        },
        {}
    );
}

function loadLocalFiles( root ) {
    const schema = _.defaultsDeep(
        loadConfigFile( root, "schema", true ),
        minSchema
    );
    const configs = configFileNames()
        .map( ( name, index ) => loadConfigFile( root, name, !index ) )
        .reverse()
    ;

    const config = _.defaultsDeep.apply( null, configs );

    return {
        schema,
        config
    }
}


async function resolveRemoteProperties( config, stage, ssmConfig ) {
    const remoteParams = extractRemoteParameters( stage ? `/${stage}` : "", config );
    if ( !_.keys( remoteParams ).length )
        return config;
    const remoteConfig = await loadRemoteConfig( findCommonRemoteParametersRoot( remoteParams ), ssmConfig );
    _.forEach( remoteParams, ( remote, local ) => {
        const value = remoteConfig[ remote ];
        if ( value !== undefined )
            _.set( config, local, remoteConfig[ remote ] );
        else {
            const root = remote + "/";
            _.forEach( remoteConfig, ( value, remote ) => {
                if ( !remote.startsWith( root ) )
                    return;
                const localPath = `${local}.${remote.substr( root.length ).replace( /\//g, "." ) }`;
                _.set( config, localPath, remoteConfig[ remote ] )
            } );
        }
    } );
    return config;
}

function combine( schema, config ) {
    const combiner = convict( schema );
    combiner.load( config );
    combiner.validate();
    const result = combiner.getProperties();
    const string = combiner.toString();
    result.toString = function () { return string; };
    result.inspect = function () { return string; };
    return Immutable( result );
}

function loadConfigImpl( postProcessor ) {
    const root = configDir();
    try {
        const { schema, config } = loadLocalFiles( root );
        return postProcessor( schema, config );
    } catch ( x ) {
        if ( x instanceof ConfigError )
            throw x;
        throw new ConfigError( `Cannot load config. ${x.message}`, x );
    }

}

function extractDefaults( schema ) {
    const combiner = convict( schema );
    combiner.load( {} );
    return combiner.getProperties();
}

export async function loadConfig( stage ) {
    return await loadConfigImpl( async ( schema, config ) => {
        const defaults = extractDefaults( schema );
        const awsConfig = { ..._.get( defaults, "aws.defaults", {} ), ..._.get( config, "aws.defaults", {} ) };
        const ssmConfig = { ..._.get( defaults, "aws.ssm", {} ), ..._.get( config, "aws.ssm", {} ) };

        AWS.config.update( awsConfig );
        return combine( schema, await resolveRemoteProperties( config, stage, ssmConfig ) );
    } );
}

export function loadLocalConfig() {
    return loadConfigImpl( combine );
}

let localCache = null;
export function localConfig( forceReload = false ) {
    localCache = !forceReload && localCache || loadLocalConfig();
    return localCache;
}

const cache = {};

export default async function config( stage, forceReload = false ) {
    const cacheKey = stage || ".empty";
    const result = !forceReload && cache[ cacheKey ] || await loadConfig( stage );
    cache[ cacheKey ] = result;
    return result;
}

