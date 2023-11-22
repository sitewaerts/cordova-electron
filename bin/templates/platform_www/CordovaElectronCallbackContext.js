/**
 * avoid exceptions when serializing objects with circular dependencies
 * @return {(key:string|null,value:any)=> any}
 * @constructor
 */
const CENSOR = ()=>
{
    const values = [];

    const maxDepth = 200;

    return function (key, value)
    {
        if (key === undefined || key === null || key === "")
        {
            values.push(value);
            return value;
        }


        if (value === undefined || value === null)
            return value;

        if (typeof(value) == "string")
            return value;

        if (typeof(value) == "number")
            return value;

        if (typeof(value) == "boolean")
            return value;

        if (typeof(value) == "function")
            return undefined;

        // nested object

        const currentParent = this;

        if (currentParent === value)
        {
            //console.log("--> Circular ref detected [" + key + "]");
            return '[Circular ' + key + ": " + typeof(value) + ']';
        }

        // close open objects on stack
        function closeStackUpToCurrent()
        {
//                console.log("closing stack " + values.length + " [" + key
//                        + "]");

            if (values.length <= 0)
                return;

            var stackLast = values[values.length - 1];
            if (stackLast === currentParent)
                return;
            values.pop();
            closeStackUpToCurrent();
        }

        closeStackUpToCurrent();

        if (values.length >= maxDepth)
        {
            //console.log("--> MaxDepth reached [" + key + "]");
            return '[MaxDepth ' + key + ": " + typeof(value) + ']';
        }

        // currentParent is now the top element on the stack

        // if value is somewhere on the stack, we have a circular ref
        const l = values.length;
        for (let i = 0; i < l; i++)
        {
            if (values[i] === value)
            {
                //console.log("--> Circular ref detected [" + key + "]");
                return '[Circular ' + typeof(value) + ']';
            }
        }

        // open new nested object
        values.push(value);
        return value;

    };
};


class PluginResult {
    /**
     *
     * @param {number} status
     * @param {any} [data]
     * @param {boolean} [keepCallback]
     */
    constructor (status, data, keepCallback) {
        this.status = status;
        this.data = data !== undefined ? data : null;
        this.keepCallback = !!keepCallback;
    }

    setKeepCallback (value) {
        this.keepCallback = value;
    }
}
PluginResult.STATUS_OK = 1;
PluginResult.STATUS_ERROR = 2;

// TODO: are these really needed?
PluginResult.ERROR_UNKNOWN_SERVICE = 4;
PluginResult.ERROR_UNKNOWN_ACTION = 8;
PluginResult.ERROR_UNEXPECTED_RESULT = 16;
PluginResult.ERROR_INVOCATION_EXCEPTION_NODE = 32;
PluginResult.ERROR_INVOCATION_EXCEPTION_CHROME = 64;

class CordovaElectronCallbackContext
{
    /**
     *
     * @param {string} contextId
     * @param window
     */
    constructor (contextId, window) {
        this.contextId = contextId;
        this.window = window;
        // add PluginResult as instance variable to be able to access it in plugins
        this.PluginResult = PluginResult;
    }

    /**
     * @param {any} result
     */
    sendPluginResult (result) {
        if(result)
            result = JSON.parse(JSON.stringify(result, CENSOR()));
        this.window.webContents.send(this.contextId, result);
    }

    /**
     * @param {any} data
     */
    progress (data) {
        this.sendPluginResult(new PluginResult(PluginResult.STATUS_OK, data, true));
    }

    /**
     * @param {any} [data]
     */
    success (data) {
        this.sendPluginResult(new PluginResult(PluginResult.STATUS_OK, data, false));
    }

    /**
     * @param {any} data
     */
    error (data) {
        this.sendPluginResult(new PluginResult(PluginResult.STATUS_ERROR, data, false));
    }
}

module.exports = { CordovaElectronCallbackContext: CordovaElectronCallbackContext, PluginResult };
