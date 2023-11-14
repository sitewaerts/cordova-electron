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

const fs = require('fs');
const path = require('path');
const {cordova} = require('./package.json');
const {installed_plugins} = require('../electron.json');
// Module to control application life, browser window and tray.
const {
    app,
    BrowserWindow,
    protocol,
    ipcMain
} = require('electron');
// Electron settings from .json file.
const cdvElectronSettings = require('./cdv-electron-settings.json');
const reservedScheme = require('./cdv-reserved-scheme.json');

const {CallbackContext} = require('./CallbackContext.js');


const devTools = cdvElectronSettings.browserWindow.webPreferences.devTools
    ? require('electron-devtools-installer')
    : false;

const scheme = cdvElectronSettings.scheme;
const hostname = cdvElectronSettings.hostname;
const isFileProtocol = scheme === 'file';

/**
 * The base url path.
 * E.g:
 * When scheme is defined as "file" the base path is "file://path-to-the-app-root-directory"
 * When scheme is anything except "file", for example "app", the base path will be "app://localhost"
 *  The hostname "localhost" can be changed but only set when scheme is not "file"
 */
const basePath = (() => isFileProtocol ? `file://${__dirname}` : `${scheme}://${hostname}`)();

if (reservedScheme.includes(scheme)) throw new Error(`The scheme "${scheme}" can not be registered. Please use a non-reserved scheme.`);

if (!isFileProtocol)
{
    protocol.registerSchemesAsPrivileged([
        {scheme, privileges: {standard: true, secure: true}}
    ]);
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

function createWindow()
{
    // Create the browser window.
    let appIcon;
    if (fs.existsSync(path.join(__dirname, 'img/app.png')))
    {
        appIcon = path.join(__dirname, 'img/app.png');
    }
    else if (fs.existsSync(path.join(__dirname, 'img/icon.png')))
    {
        appIcon = path.join(__dirname, 'img/icon.png');
    }
    else
    {
        appIcon = path.join(__dirname, 'img/logo.png');
    }

    const browserWindowOpts = Object.assign({}, cdvElectronSettings.browserWindow, {icon: appIcon});
    browserWindowOpts.webPreferences.preload = path.join(app.getAppPath(), 'cdv-electron-preload.js');
    browserWindowOpts.webPreferences.contextIsolation = true;
    browserWindowOpts.webPreferences.sandbox = false; // https://www.electronjs.org/docs/latest/tutorial/sandbox#disabling-the-sandbox-for-a-single-process

    mainWindow = new BrowserWindow(browserWindowOpts);

    // Load a local HTML file or a remote URL.
    const cdvUrl = cdvElectronSettings.browserWindowInstance.loadURL.url;
    const loadUrl = cdvUrl.includes('://') ? cdvUrl : `${basePath}/${cdvUrl}`;
    const loadUrlOpts = Object.assign({}, cdvElectronSettings.browserWindowInstance.loadURL.options);

    mainWindow.loadURL(loadUrl, loadUrlOpts);

    // Open the DevTools.
    if (cdvElectronSettings.browserWindow.webPreferences.devTools)
    {
        mainWindow.webContents.openDevTools();
    }

    // Emitted when the window is closed.
    mainWindow.on('closed', () =>
    {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null;
    });
}

function configureProtocol()
{
    protocol.registerFileProtocol(scheme, (request, cb) =>
    {
        const url = request.url.substr(basePath.length + 1);
        cb({path: path.normalize(path.join(__dirname, url))}); // eslint-disable-line node/no-callback-literal
    });

    protocol.interceptFileProtocol('file', (_, cb) =>
    {
        cb(null);
    });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () =>
{
    if (!isFileProtocol)
    {
        configureProtocol();
    }

    if (devTools && cdvElectronSettings.devToolsExtension)
    {
        const extensions = cdvElectronSettings.devToolsExtension.map(id => devTools[id] || id);
        devTools.default(extensions) // default = install extension
            .then((name) => console.log(`Added Extension '${name}'`))
            .catch((err) => console.error(`An error occurred while adding Extension '${name}'`, err));
    }

    createWindow();
});

// Quit when all windows are closed.
app.on('window-all-closed', () =>
{
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin')
    {
        app.quit();
    }
});

app.on('activate', () =>
{
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null)
    {
        if (!isFileProtocol)
        {
            configureProtocol();
        }

        createWindow();
    }
});

class Service
{
    /**
     *
     * @param {string} serviceName
     */
    constructor(serviceName)
    {
        this.serviceName = serviceName;

        const serviceInfo = cordova && cordova.services && cordova.services[serviceName];
        // this condition should never be met, exec.js already tests for it.
        if (!serviceInfo)
        {
            console.error(`Invalid Service. Service '${this.serviceName}' does not have an electron implementation.`);
            this._exec = (action, args, callbackContext)=>{
                const message = `Cannot execute action '${this.serviceName}.${action} 'as service '${this.serviceName}' isn't available.`;
                console.error(message);
                callbackContext.error(message)
            };
            return
        }
        this.module = serviceInfo.electronModule;
        this.pluginId = serviceInfo.pluginId;

        const module = require(this.module);

        if (typeof module !== 'function')
        {
            console.warn('WARNING! Plugin ' + this.module + ' is using a deprecated API which is lacking support for progress callbacks. Migrate to the current cordova-electron Plugin API. Support for this API may be removed in future releases.');

            const _impl = module;
            this._impl = Promise.resolve(_impl);

            this._exec = (action, args, callbackContext) =>
            {
                // console.log(this.module + '.' + action + '(' + (args || []).join(',') + ') ...');

                const _implAction = _impl[action];
                if(!_implAction)
                {
                    const message = `Invalid action. Service '${this.module}' does not have an electron implementation for action '${action}'.`;
                    callbackContext.error(message);
                    return;
                }

                Promise.resolve(_implAction(args)).then((result) =>
                {
                    // console.log(this.module + '.' + action + '(' + (args || []).join(',') + ') done', result);
                    callbackContext.success(result);
                }, (error) =>
                {
                    // console.log(this.module + '.' + action + '(' + (args || []).join(',') + ') failed', error);
                    callbackContext.error(error);
                });
            }
        }
        else
        {

            /**
             * @type {Promise<any>}
             * @private
             */
            const _impl = this._impl = (async () =>
            {
                if (module.init)
                    try
                    {
                        const variables = installed_plugins[this.pluginId] || {};
                        await module.init(variables, serviceLoader);
                    } catch (error)
                    {
                        console.error("cannot init module " + this.module + " for service " + serviceName, error);
                        this._exec = (action, args, callbackContext)=>{
                            const message = `Cannot execute action '${this.serviceName}.${action} 'as service '${this.serviceName}' wasn't successfully initialized.`;
                            console.error(message);
                            callbackContext.error(message)
                        };
                        return null;
                    }
                return module;
            })();

            this._exec = (action, args, callbackContext) =>
            {
                _impl
                    .then((impl) =>
                    {
                        return impl(action, args, callbackContext)
                    })
                    .then((result) =>
                    {
                        if (result === true)
                        {
                            // action found and invoked. success/error handling via callbackContext performed inside the action impl
                        }
                        else if (result === false)
                        {
                            const message = `Invalid action. Service '${this.module}' does not have an electron implementation for action '${action}'.`;
                            callbackContext.error(message);
                        }
                        else
                        {
                            const message = 'Unexpected plugin exec result' + result;
                            console.error(message, result);
                            callbackContext.error(message);
                        }
                    })
                    .catch((exception) =>
                    {
                        const message = "Unexpected exception while invoking service action '" + this.module + '.' + action + "'\r\n" + exception;
                        console.error(message, exception);
                        callbackContext.error({message, exception});
                    })
            }

        }


    }

    /**
     * @return {Promise<any>}
     */
    getImpl()
    {
        return this._impl;
    }

    /**
     *
     * @param {string} action
     * @param {Array<any>} args
     * @param {CallbackContext} callbackContext
     * @void
     */
    exec(action, args, callbackContext)
    {
        this._exec(action, args, callbackContext)
    }

}

/**
 * @type {Record<string, Service>}
 * @private
 */
const _SERVICES = {};

/**
 * @param {string} serviceName
 * @returns {Service}
 */
function getService(serviceName)
{
    return _SERVICES[serviceName] = _SERVICES[serviceName] || new Service(serviceName);
}

/**
 * @param {string} serviceName
 * @returns {Promise<any>}
 */
function serviceLoader(serviceName)
{
    const s = getService(serviceName);
    return s ? s.getImpl() : Promise.resolve(null);
}


ipcMain.handle('cdv-plugin-exec', (_, serviceName, action, args, callbackId) =>
{
    // This function should never return a rejected promise or throw an exception, as otherwise ipcRenderer callback will convert the parameter to a string encapsulated in an Error. See https://github.com/electron/electron/issues/24427

    const callbackContext = new CallbackContext(callbackId, mainWindow);

    try
    {
        getService(serviceName).exec(action, args, callbackContext);
    } catch (error)
    {
        const message = "Unexpected exception while invoking service action '" + serviceName + '.' + action + "'\r\n" + error;
        console.error(message, error);
        callbackContext.error({message, error});
    }

});
