// @flow
"use strict";

import ConfigError from "./errors";
import minSchema from "./min-schema.json";

import AWS from "aws-sdk";
import convict from "convict";
import fs from "fs";
import { defaultsDeep, findIndex, forEach, get, isArray, isObject, isString, keys, reduce, set } from "lodash";
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
    try {
        if ( fileExist( filePath ) )
            return JSON.parse( fs.readFileSync( filePath, { encoding: "utf8" } ) );
        if ( !required )
            return {};
    } catch( x ) {
        throw new ConfigError( `Cannot read config file: ${name}`, x )
    }
    throw new ConfigError( `Required config file doesn't exist: ${name}`, filePath );
}

function processParameter( stagePrefix, value, keyPath: string, result: { [string]: any } ) {
    if ( isString( value ) && value.startsWith( "@/" ) ) {
        result[ keyPath ] = `${stagePrefix}${value.substr( 1 )}`;
        return result;
    }
    if ( isObject( value ) )
        return extractRemoteParameters( stagePrefix, value, keyPath, result );
    return result;
}

export function extractRemoteParameters( stagePrefix: string, config: { [string]: any } | Array<any>, path: string = "", result: { [string]: any } = {} ) {
    const keyPath = isArray( config )
        ? ( key ) => `${path}[${key}]`
        : ( key ) => path ? `${path}.${key}` : `${key}`
    ;
    return reduce(
        config,
        ( result, value, key ) => processParameter( stagePrefix, value, keyPath( key ), result ),
        result
    );
}

export function findCommonRemoteParametersRoot( remoteParams: { [string]: string } ) {
    const rootParts = reduce(
        remoteParams,
        ( rootParts, value ) => {
            const valueParts = value.split( "/" );
            if ( !rootParts )
                return valueParts;
            const index = findIndex( rootParts, ( value: string, index: number ) => { return valueParts[ index ] !== value; } );
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

async function loadRemoteConfig( path, region ) {
    const ssm = new AWS.SSM( { region } );
    const getParametersByPath = Promise.promisify( ssm.getParametersByPath, { context: ssm } );
    const { Parameters } = await getParametersByPath( { Path: path, Recursive: true, WithDecryption: true } );
    return reduce(
        Parameters,
        ( result, parameter ) => {
            result[ parameter.Name ] = parameter.Value;
            return result;
        },
        {}
    );
}

function loadLocalFiles( root ){
    const schema = defaultsDeep(
        loadConfigFile( root, "schema", true ),
        minSchema
    );
    const configs = configFileNames()
        .map( ( name, index ) => loadConfigFile( root, name, !index ) )
        .reverse()
    ;

    const config = defaultsDeep.apply( null, configs );

    return {
        schema,
        config
    }
}


async function resolveRemoteProperties( config, stage, region ) {
    const remoteParams = extractRemoteParameters( stage ? `/${stage}` : "", config );
    if ( !keys( remoteParams ).length )
        return config;
    const remoteConfig = await loadRemoteConfig( findCommonRemoteParametersRoot( remoteParams ), region );
    forEach( remoteParams, ( remote, local ) => {
        const value = remoteConfig[ remote ];
        if ( value !== undefined )
            set( config, local, remoteConfig[ remote ] );
        else {
            const root = remote + "/";
            forEach( remoteConfig, ( value, remote ) => {
                if ( !remote.startsWith( root ) )
                    return;
                const localPath = `${local}.${remote.substr( root.length ).replace( "/", "." ) }`;
                set( config, localPath, remoteConfig[ remote ] )
            } );
        }
    } );
    return config;
}

function combine( schema, config ) {
    const combiner = convict( schema );
    combiner.load( config );
    combiner.validate();
    return Immutable( reduce( Object.keys( schema ), ( result, key ) => {
        result[key] = combiner.get( key );
        return result;
    }, {} ) );
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

export async function loadConfig( stage: ?string ) {
    return await loadConfigImpl( async ( schema, config ) => {
        const region = config.SSMRegion || get( schema, "SSMRegion.default", null );
        if ( !region )
            throw new ConfigError( "Cannot load config, SSM region is undefined." );

        return combine( schema, await resolveRemoteProperties( config, stage, region ) );
    } );
}

export function loadLocalConfig() {
    return loadConfigImpl( combine );
}

const cache = {};

export default async function config( stage: ?string ) {
    const cacheKey = stage || ".empty";
    const result = cache[cacheKey] || await loadConfig( stage );
    cache[cacheKey] = result;
    return result;
}
