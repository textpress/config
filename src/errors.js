"use strict";

import ExtendableError from "@textpress/extendable-error";

export class ConfigError extends ExtendableError {
    constructor( message, extra ) {
        super( message, extra );
    }
}

export default ConfigError;
