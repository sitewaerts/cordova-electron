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
            .then((name) => console.log(`Added Extension:  ${name}`))
            .catch((err) => console.log('An error occurred: ', err));
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

/**
 * @type {Record<string, boolean>}
 * @private
 */
const _SERVICE_API_WARNINGS = {};

/**
 * @type {Record<string, boolean>}
 * @private
 */
const _SERVICE_INITIALIZED = {};

/**
 *
 * @param {string} serviceName
 * @return {Record<string, string>}
 */
function getVariables(serviceName)
{
    const serviceInfo = cordova.services[serviceName];
    if (!serviceInfo)
    {
        const message = `NODE: Invalid Service. Service '${serviceName}' does not have an electron implementation.`;
        console.error(message);
        throw new Error(message);
    }
    return installed_plugins[serviceInfo.pluginId] || {};
}

/**
 * @param {string} serviceName
 * @returns {Promise<{module:string, service:any}>}
 */
async function getService(serviceName)
{
    const serviceInfo = cordova && cordova.services && cordova.services[serviceName];
    // this condition should never be met, exec.js already tests for it.
    if (!serviceInfo)
        throw new Error(`NODE: Invalid Service. Service '${serviceName}' does not have an electron implementation.`);

    /**
     * @type {string}
     */
    const electronModule = serviceInfo.electronModule;

    const plugin = require(electronModule);

    if (!_SERVICE_INITIALIZED[electronModule])
    {
        _SERVICE_INITIALIZED[electronModule] = true;
        if (plugin.init)
            await plugin.init(getVariables(serviceName), serviceLoader);
    }
    return {module:electronModule, service:plugin};
}

/**
 * @param {string} serviceName
 * @returns {Promise<any>}
 */
async function serviceLoader(serviceName){
    const s = await getService(serviceName);
    return s && s.service;
}


ipcMain.handle('cdv-plugin-exec', (_, serviceName, action, args, callbackId) =>
{
    // This function should never return a rejected promise or throw an exception, as otherwise ipcRenderer callback will convert the parameter to a string incapsulated in an Error. See https://github.com/electron/electron/issues/24427

    const {CallbackContext} = require('./CallbackContext.js');
    const callbackContext = new CallbackContext(callbackId, mainWindow);

    getService(serviceName).then(
        (service) =>
        {
            const module = service.module;
            const plugin = service.service;
            // backwards compatible plugin call handling
            if (typeof plugin !== 'function')
            {
                if (!_SERVICE_API_WARNINGS[serviceName])
                {
                    _SERVICE_API_WARNINGS[serviceName] = true;
                    console.warn('WARNING! Plugin ' + module + ' is using a deprecated API lacking support for progress callbacks. Migrate to the current cordova-electron Plugin API. Support for this API may be removed in future versions.');
                }
                try
                {
                    // console.log(cordova.services[serviceName] + '.' + action + '(' + (args || []).join(',') + ') ...');

                    Promise.resolve(plugin[action](args)).then((result) =>
                    {
                        // console.log(cordova.services[serviceName] + '.' + action + '(' + (args || []).join(',') + ') done', result);
                        callbackContext.success(result);
                    }, (error) =>
                    {
                        // console.log(cordova.services[serviceName] + '.' + action + '(' + (args || []).join(',') + ') failed', error);
                        callbackContext.error(error);
                    });
                } catch (exception)
                {
                    const message = "NODE: Exception while invoking service action '" + serviceName + '.' + action + "'\r\n" + exception;
                    // print error to terminal
                    console.error(message, exception);
                    // trigger node side error callback
                    callbackContext.error({message, exception});
                }
                return;
            }

            // new plugin API handling
            try
            {

                Promise.resolve(plugin(action, args, callbackContext))
                    .then((result) =>
                    {
                        if (result === true)
                        {
                            // successful invocation
                        }
                        else if (result === false)
                        {
                            const message = `NODE: Invalid action. Service '${module}' does not have an electron implementation for action '${action}'.`;
                            callbackContext.error(message);
                        }
                        else
                        {
                            const message = 'NODE: Unexpected plugin exec result' + result;
                            callbackContext.error(message);
                        }
                    }, (exception) =>
                    {
                        const message = "NODE: Exception (inner) while invoking service action '" + module + '.' + action + "'\r\n" + exception;
                        // print error to terminal
                        console.error(message, exception);
                        // trigger node side error callback
                        callbackContext.error({message, exception});
                    })

            } catch (exception)
            {
                const message = "NODE: Exception (outer) while invoking service action '" + module + '.' + action + "'\r\n" + exception;
                // print error to terminal
                console.error(message, exception);
                // trigger node side error callback
                callbackContext.error({message, exception});
            }
        },
        (error) =>
        {
            callbackContext.error(error);
        }
    );


});
