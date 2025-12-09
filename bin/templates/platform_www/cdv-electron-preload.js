/*
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/

const {contextBridge, ipcRenderer} = require('electron');
const {cordova} = require('./package.json');

const {PluginResult} = require('./CordovaElectronCallbackContext.js');

// usefully to find preload script sources in debugger as chrome console
// links to source file
console.log("executing cdv-electron-preload.js");

contextBridge.exposeInMainWorld('_cdvElectronIpc', {
    /**
     *
     * @param {(data:any)=>void} success
     * @param {((error:any)=>void) | null} error
     * @param {string} serviceName
     * @param {string} action
     * @param {ArrayLike<any> | null} args
     * @param {string} callbackId
     * @returns {Promise<void>}
     */
    exec: async (success, error, serviceName, action, args, callbackId) =>
    {
        const onError = (cause) =>
        {
            if (!error)
            {
                console.error("CHROME: Error while invoking service action '" + serviceName + '.' + action + "'. No error callback provided.", {
                    args: args,
                    cause: cause
                });
            }
            else
            {
                try
                {
                    error(cause)
                } catch (e)
                {
                    console.error("CHROME: Caught exception from error callback for service action " + serviceName + '.' + action
                        + ". Better handle/catch this error in the error callback.", {
                        args: args,
                        cause: cause,
                        error: e
                    });

                }
            }

        }

        const onSuccess = (result) =>
        {
            if (!success)
                return;
            try
            {
                success(result.data);
            } catch (e)
            {
                onError({
                    message: "CHROME: Caught exception from success callback for service action " + serviceName + '.' + action
                        + ". Better handle/catch this error in the success callback.",
                    cause: e,
                    result: result
                });
            }
        }


        ipcRenderer.on(callbackId, (event, result) =>
        {
            if (result.status === PluginResult.STATUS_OK)
            {
                onSuccess(result);
            }
            else if (result.status && PluginResult.STATUS_ERROR)
            {
                onError(result.data);
            }
            else
            {
                onError(new Error('CHROME: Unexpected plugin result status code: ' + result.status));
            }

            if (!result.keepCallback)
            {
                ipcRenderer.removeAllListeners(callbackId);
            }
        });
        try
        {
            //console.log("ipcRenderer.invoke(" + serviceName + ", " + action + ", [" +  (args || []).join(", ") + "], " +  callbackId + ")");
            await ipcRenderer.invoke('cdv-plugin-exec', serviceName, action, args, callbackId);
        } catch (exception)
        {
            const message = "CHROME: Caught unhandled exception from service action '" + serviceName + '.' + action + "'";
            console.error(message, exception);
            onError({message, exception});
        }
    },

    hasService: (serviceName) => cordova && cordova.services && cordova.services[serviceName],

    /**
     *
     * @param {string} pluginID
     * @param {string} eventName
     * @param {(payload?:any)=>void} handler
     * @return {()=>void} remover
     */
    onPluginEvent: (pluginID, eventName, handler) =>
    {
        /**
         *
         * @type {IpcRendererEvent} event
         * @type {PluginEvent} pluginEventInfo
         */
        const listener = (event, pluginEventInfo) =>
        {
            try
            {
                if (pluginEventInfo.pluginId === pluginID && pluginEventInfo.eventName === eventName)
                {
                    handler(pluginEventInfo.payload);
                }
            } catch (e)
            {
                console.error("cannot handle plugin event", {event: event, pluginEventInfo: pluginEventInfo, cause: e});
            }
        };

        ipcRenderer.on('cdv-plugin-events', listener);
        return () =>
        {
            ipcRenderer.removeListener('cdv-plugin-events', listener);
        }

    }
});
