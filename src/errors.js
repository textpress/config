// @flow
"use strict";

import ExtendableError from "@textpress/extendable-error";

export class ConfigError extends ExtendableError {
    constructor( message: string, extra?: mixed ) {
        super( message, extra );
    }
}

export default ConfigError;
