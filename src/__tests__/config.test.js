"use strict";

import * as config from "..";
import { ConfigError } from "../errors";

import AWS from "aws-sdk";
import path from "path";
import Immutable from "seamless-immutable";
import sinon from "sinon";
import _ from "lodash";

import remoteTestConfig from "./__fixtures__/remoteConfig/test.json";
import ssmTestResponse from "./__fixtures__/ssm-response.json";
import ssmNoStageResponse from "./__fixtures__/ssm-no-stage-response.json";


describe( "config", () => {

    const originalEnv = process.env.NODE_ENV;
    const originalConfigDir = process.env.NODE_CONFIG_DIR;

    const sandbox = sinon.createSandbox();
    let ssmStub = sandbox.spy();

    beforeEach( function () {
        ssmStub = sandbox.stub( AWS.Service.prototype, "makeRequest" ).yields( null, ssmTestResponse );
    } );

    afterEach( function () {
        sandbox.restore();

        if ( originalEnv )
            process.env.NODE_ENV = originalEnv;
        else
            delete process.env.NODE_ENV;

        if ( originalConfigDir )
            process.env.NODE_CONFIG_DIR = originalConfigDir;
        else
            delete process.env.NODE_CONFIG_DIR;

    } );

    describe( "extractRemoteParameters", () => {

        it( "works with stage prefix", () => {
            expect( config.extractRemoteParameters( "/production", remoteTestConfig ) ).toMatchSnapshot();
        } );

        it( "works without stage prefix", () => {
            expect( config.extractRemoteParameters( "", remoteTestConfig ) ).toMatchSnapshot();
        } );

        it( "works with empty config", () => {
            expect( config.extractRemoteParameters( "", {} ) ).toMatchSnapshot();
        } );

    } );

    describe( "findCommonRemoteParametersRoot", () => {

        it( "works", () => {
            expect( config.findCommonRemoteParametersRoot( {
                "jenkins.auth": "/production/textpress-ci/jenkins/auth",
                "jenkins.token": "/production/textpress-ci/jenkins/token",
                "jenkins.url": "/production/textpress-ci/jenkins/url",
                "signatureSecret": "/production/textpress-ci/signatureSecret",
            } ) ).toEqual( "/production/textpress-ci" );
        } );

        it( "returns empty root if no common root is found", () => {
            expect( config.findCommonRemoteParametersRoot( {
                "jenkins.auth": "/production/textpress-ci/jenkins/auth",
                "jenkins.token": "/development/textpress-ci/jenkins/token",
                "jenkins.url": "/staging/textpress-ci/jenkins/url",
                "signatureSecret": "/local/textpress-ci/signatureSecret",
            } ) ).toEqual( "/" );
        } );

    } );

    describe( "loadConfig", () => {

        it( "works", async () => {
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "remoteConfig" );

            const cfg = await config.loadConfig( "test" );
            expect( ssmStub.calledOnce ).toBe( true );
            expect( ssmStub.args[0] ).toMatchSnapshot();
            expect( Immutable.isImmutable( cfg ) ).toBe( true );
            expect( cfg ).toMatchSnapshot();
        } );

        it( "extends AWS configuration", async () => {
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "extendedAWSRemoteConfig" );

            await config.loadConfig( "test" );
            expect( _.pick( AWS.config, [ "region", "sslEnabled" ] ) ).toMatchSnapshot();
        } );

        it( "replaces AWS configuration", async () => {
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "replacedAWSRemoteConfig" );

            await config.loadConfig( "test" );
            expect( _.pick( AWS.config, [ "region" ] ) ).toMatchSnapshot();
        } );


        it( "fails if cannot find file for current node environment", async () => {
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "brokenConfig" );

            expect.assertions( 2 );
            try {
                await config.loadConfig( "test" );
            } catch ( x ) {
                expect( x ).toBeInstanceOf( ConfigError );
                expect( x.message ).toBe( "Required config file doesn't exist: test.json" );
            }
        } );


        it( "works when node environment is production and stage is provided", async () => {
            process.env.NODE_ENV = "production";
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "remoteConfig" );

            const cfg = await config.loadConfig( "test" );
            expect( ssmStub.calledOnce ).toBe( true );
            expect( ssmStub.args[0] ).toMatchSnapshot();
            expect( Immutable.isImmutable( cfg ) ).toBe( true );
            expect( cfg ).toMatchSnapshot();
        } );

        it( "works when node environment is production and stage is not provided", async () => {
            process.env.NODE_ENV = "production";
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "remoteConfig" );

            ssmStub.yields( null, ssmNoStageResponse );

            const cfg = await config.loadConfig();
            expect( ssmStub.calledOnce ).toBe( true );
            expect( ssmStub.args[0] ).toMatchSnapshot();
            expect( Immutable.isImmutable( cfg ) ).toBe( true );
            expect( cfg ).toMatchSnapshot();
        } );


    } );

    describe( "loadLocalConfig", () => {

        beforeAll( () => {
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "localConfig" );
        } );

        it( "works", async () => {
            const cfg = config.loadLocalConfig();
            expect( ssmStub.called ).toBe( false );
            expect( Immutable.isImmutable( cfg ) ).toBe( true );
            expect( cfg ).toMatchSnapshot();
        } );

        it( "fails if cannot find file for current node environment", async () => {
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "brokenConfig" );

            try {
                config.loadLocalConfig();
            } catch ( x ) {
                expect( x ).toBeInstanceOf( ConfigError );
                expect( x.message ).toBe( "Required config file doesn't exist: test.json" );
            }
        } );

    } );

    describe( "localConfig", () => {

        it( "works", () => {
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "localConfig" );
            const cfg1 = config.localConfig();
            const cfg2 = config.localConfig();
            expect( cfg1 ).toBe( cfg2 );
            expect( ssmStub.called ).toBe( false );
            expect( Immutable.isImmutable( cfg1 ) ).toBe( true );
            expect( cfg1 ).toMatchSnapshot();
        } );

        it( "doesn't print sensitive data with toString()", () => {
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "sensitiveConfig" );
            const result = config.localConfig( true );
            expect( result.toString() ).toMatchSnapshot();
        } );

        it( "doesn't print sensitive data with inspect()", async () => {
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "sensitiveConfig" );
            const result = config.localConfig( true );
            expect( result.inspect() ).toMatchSnapshot();
        } );

    } );

    describe( "config", () => {

        it( "works", async () => {
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "remoteConfig" );
            const cfg1 = await config.default( "test" );
            const cfg2 = await config.default( "test" );
            expect( cfg1 ).toBe( cfg2 );
            expect( ssmStub.calledOnce ).toBe( true );
            expect( ssmStub.args[0] ).toMatchSnapshot();
            expect( Immutable.isImmutable( cfg1 ) ).toBe( true );
            expect( Immutable.isImmutable( cfg2 ) ).toBe( true );
            expect( cfg1 ).toMatchSnapshot();
        } );

        it( "doesn't print sensitive data with toString()", async () => {
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "sensitiveConfig" );
            const result = await config.default( "test", true );
            expect( result.toString() ).toMatchSnapshot();
        } );

        it( "doesn't print sensitive data with inspect()", async () => {
            process.env.NODE_CONFIG_DIR = path.join( __dirname, "__fixtures__", "sensitiveConfig" );
            const result = await config.default( "test", true );
            expect( result.inspect() ).toMatchSnapshot();
        } );

    } );

} );
