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

const {
    app,
    net,
    BrowserWindow,
    protocol,
    session,
    ipcMain,
    dialog
} = require('electron');
const cdvElectronSettings = require("./cdv-electron-settings.json");

try
{
    const fs = require('fs');
    const path = require('path');
    const url = require('url');
    const {cordova} = require('./package.json');
    const {installed_plugins} = require('./electron.json');

    /**
     * @type {*}
     */
    const cdvElectronSettings = require('./cdv-electron-settings.json');
    const reservedScheme = require('./cdv-reserved-scheme.json');

    const {CordovaElectronCallbackContext} = require('./CordovaElectronCallbackContext.js');
    const {
        CordovaElectronPluginConfigContext,
        CordovaElectronPluginInitContext
    } = require('./CordovaElectronPluginContext.js');


    const devTools = cdvElectronSettings.browserWindow.webPreferences.devTools
        ? require('electron-devtools-installer')
        : false;

    const scheme = cdvElectronSettings.scheme;
    if (reservedScheme.includes(scheme))
        throw new Error(`The scheme "${scheme}" can not be registered. Please use a non-reserved scheme.`);
    const hostname = cdvElectronSettings.hostname;
    const isFileProtocol = scheme === 'file';

    /**
     * The base url path.
     * E.g:
     * When scheme is defined as "file" the base path is "file://path-to-the-app-root-directory"
     * When scheme is anything except "file", for example "app", the base path will be "app://localhost/application"
     *  The hostname "localhost" can be changed but only set when scheme is not "file"
     */
    const basePath = (() => isFileProtocol ? `file://${__dirname}` : `${scheme}://${hostname}/application`)();


    /**
     * Keep a global reference of the window object, if you don't, the window will
     * be closed automatically when the JavaScript object is garbage collected.
     *
     * @type {electron.BrowserWindow}
     */
    let mainWindow;

    /**
     *
     * @type {Array<string>}
     */
    let allSchemesPartitions = [];

    class Service
    {
        /**
         *
         * @param {string} serviceName
         */
        constructor(serviceName)
        {
            this.serviceName = serviceName;
            this._initialized = false;

            const serviceInfo = cordova && cordova.services && cordova.services[serviceName];
            // this condition should never be met, exec.js already tests for it.
            if (!serviceInfo)
            {
                console.error(`Invalid Service. Service '${this.serviceName}' does not have an electron implementation.`);
                this._exec = (action, args, callbackContext) =>
                {
                    const message = `Cannot execute action '${this.serviceName}.${action} 'as service '${this.serviceName}' isn't available.`;
                    console.error(message);
                    callbackContext.error(message)
                };
                this._initialized = true;
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
                    if (!_implAction)
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

                this._initialized = true;
            }
            else
            {

                /**
                 * @type {Promise<any>}
                 * @private
                 */
                const _impl = this._impl = (async () =>
                {
                    if (module.initialize)
                    {
                        try
                        {
                            await app.whenReady();
                            await module.initialize(new CordovaElectronPluginInitContext(
                                installed_plugins[this.pluginId],
                                scheme,
                                hostname,
                                Service.serviceLoader,
                                mainWindow,
                                app,
                                allSchemesPartitions
                            ));
                            this._initialized = true;
                        } catch (error)
                        {
                            console.error("cannot init module " + this.module + " for service " + serviceName, error);
                            this._exec = (action, args, callbackContext) =>
                            {
                                const message = `Cannot execute action '${this.serviceName}.${action} 'as service '${this.serviceName}' wasn't successfully initialized.`;
                                console.error(message);
                                callbackContext.error(message)
                            };
                            this._initialized = true;
                            return null;
                        }
                    }
                    else
                    {
                        this._initialized = true;
                    }
                    return module;
                })();

                this._exec = (action, args, callbackContext) =>
                {
                    _impl
                        .then((impl) =>
                        {
                            return impl ? impl(action, args, callbackContext) : 'service ' + serviceName + 'not available'
                        })
                        .then((result) =>
                        {
                            if (result === true)
                            {
                                // action found and executed. success/error handling via callbackContext performed inside the action impl
                                // nothing to do here
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
         * @param {ConfigureResult} result
         * @void
         */
        configure(result)
        {
            try
            {
                const module = require(this.module);
                if (module.configure)
                    module.configure(new CordovaElectronPluginConfigContext(
                        installed_plugins[this.pluginId],
                        scheme,
                        hostname,
                        app,
                        result.schemes,
                        result.defaultProtocols,
                        result.allSchemesPartitions
                    ))
            } catch (e)
            {
                const message = "cannot configure module '" + this.module + "' for service '" + this.serviceName + "': " + e.message;
                console.error(message, e);
                throw new Error(message);
            }
        }

        /**
         * @return {boolean}
         */
        isInitialized()
        {
            return this._initialized;
        }

        /**
         * @return {Promise<void>}
         */
        initialized()
        {
            return this._impl.then();
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
         * @param {CordovaElectronCallbackContext} callbackContext
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
    Service._SERVICES = {};

    /**
     * @param {string} serviceName
     * @returns {Service}
     */
    Service.getService = (serviceName) =>
    {
        return Service._SERVICES[serviceName] = Service._SERVICES[serviceName] || new Service(serviceName);
    }

    /**
     * @param {string} serviceName
     * @returns {Promise<any>}
     */
    Service.serviceLoader = (serviceName) =>
    {
        let s = Service._SERVICES[serviceName];
        if (s && !s.isInitialized())
        {
            // TODO detect circular dependencies here ...
            // return Promise.reject("circular service dependency detected. Requested service '" + serviceName + "' not fully initialized");
        }
        if (!s)
            s = Service.getService(serviceName);
        return s.getImpl();
    }


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

        if(cdvElectronSettings['overrideUserAgent'])
            mainWindow.webContents.setUserAgent(cdvElectronSettings['overrideUserAgent'])
        else if(cdvElectronSettings['appendUserAgent'])
            mainWindow.webContents.setUserAgent(mainWindow.webContents.getUserAgent() + " " + cdvElectronSettings['appendUserAgent'])


        // Emitted when the window is closed.
        mainWindow.once('closed', () =>
        {
            mainWindow.removeAllListeners('closed');
            console.log('mainWindow.closed')
            // Dereference the window object, usually you would store windows
            // in an array if your app supports multi windows, this is the time
            // when you should delete the corresponding element.
            mainWindow = null;
        });
    }

    function loadStartPage()
    {
        // Load a local HTML file or a remote URL.
        const cdvUrl = cdvElectronSettings.browserWindowInstance.loadURL.url;
        const loadUrl = cdvUrl.includes('://') ? cdvUrl : `${basePath}/${cdvUrl}`;
        const loadUrlOpts = Object.assign({}, cdvElectronSettings.browserWindowInstance.loadURL.options);

        mainWindow.loadURL(loadUrl, loadUrlOpts).catch((error) =>
        {
            console.error("cannot load main window " + loadUrl, error, loadUrlOpts);
        });

        // Open the DevTools.
        if (cdvElectronSettings.browserWindow.webPreferences.devTools)
        {
            mainWindow.webContents.openDevTools();
        }
    }


    /**
     * @typedef {Object} ConfigureResult
     * @property {Record<string, electron.CustomScheme>} schemes
     * @property {Array<string>} defaultProtocols
     * @property {Array<string>} allSchemesPartitions
     */

    /**
     *
     * @return {ConfigureResult}
     */
    function configureServices()
    {

        /**
         * @type {ConfigureResult}
         */
        const result = {schemes: {}, defaultProtocols: [], allSchemesPartitions: allSchemesPartitions};
        if (cordova?.services)
        {
            for (const serviceName in cordova.services)
                Service.getService(serviceName).configure(result);
        }
        return result;
    }

    async function initPlugins()
    {
        if (!cordova?.services)
            return;
        for (const serviceName in cordova.services)
            await Service.getService(serviceName).initialized();
    }

    /**
     * @param {string} fileUrl
     * @return {string|null}
     */
    function getFilePathForSchemeUrl(fileUrl)
    {
        if (!fileUrl.startsWith(basePath))
            return null; // leaving the sandbox is forbidden
        const osPath = path.normalize(url.fileURLToPath(fileUrl));
        if (!osPath.startsWith(__dirname))
            return null; // leaving the sandbox is forbidden
        return osPath;
    }


    function configureProtocol()
    {
        function configure(protocol)
        {
            // restrict file scheme handler to app path
            if (!protocol.isProtocolIntercepted('file'))
            {
                protocol.interceptFileProtocol('file', (request, cb) =>
                {
                    const osPath = path.normalize(url.fileURLToPath(request.url));
                    if (!osPath.startsWith(__dirname))
                        cb({statusCode: 404}); // leaving the sandbox is forbidden
                    else
                        cb(osPath)
                    return true;
                });
            }

            if (isFileProtocol)
                return;

            // register custom protocol handler, if not already registered by cordova-plugin-file (or others)
            // obviously there is a bug in electron: protocol.handle cannot overwrite already registered protocol even if protocol.unhandle is called
            if (!protocol.isProtocolHandled(scheme))
            {
                protocol.handle(scheme, (request) =>
                {
                    if (!request.url.startsWith(basePath))
                        return new Response(null, {status: 404}); // leaving the sandbox is forbidden
                    const osPath = path.normalize(path.join(__dirname, request.url.slice(basePath.length)));
                    if (!osPath.startsWith(__dirname))
                        return new Response(null, {status: 404}); // leaving the sandbox is forbidden

                    // this requires the file protocol to be available.
                    return net.fetch(url.pathToFileURL(osPath).toString());
                    // .then((response) =>
                    // {
                    //     // could apply defs from config.xml here: e.g. <access origin="cdvfile://*" /> ....
                    //     // response.headers.set('Access-Control-Allow-Origin', '*')
                    //     return response;
                    // })
                });
            }
        }

        // ??? use protocol instance for window. it may differ from default/global protocol if window uses a dedicated session and/or partition
        // see https://www.electronjs.org/docs/latest/api/protocol#using-protocol-with-a-custom-partition-or-session
        //configure(mainWindow.webContents.session.protocol);
        configure(protocol);
        for(const partition of configResult.allSchemesPartitions){
            const p = session.fromPartition(partition).protocol;
            configure(p);
        }

    }

    function startApp()
    {
        (async () =>
        {
            if (devTools && cdvElectronSettings.devToolsExtension)
            {
                const extensions = cdvElectronSettings.devToolsExtension.map(id => devTools[id] || id);
                await devTools.default(extensions) // default = install extension
                    .then((result) => console.log(`Added extensions: '${result}'`))
                    .catch((err) => console.error('Failed to add extensions', err));
            }
            createWindow();
            await initPlugins();
            configureProtocol();
            loadStartPage();
        })().catch((error) =>
        {
            console.error("cannot start app", error);
        })
    }


    /** startup **/


    const configResult = configureServices();

    /**
     *
     * @type {Array<electron.CustomScheme>}
     */
    const customSchemes = [
        {
            scheme,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
                allowServiceWorkers: true,
                corsEnabled: true,
                bypassCSP: true,
                stream: true
            }
        }
    ];
    for (let scheme in configResult.schemes)
    {
        customSchemes.push(configResult.schemes[scheme]);
    }

    // register at default session.protocol
    protocol.registerSchemesAsPrivileged(customSchemes);
    // for(const partition of configResult.allSchemesPartitions){
    //     const p = session.fromPartition(partition).protocol;
    //     p.registerSchemesAsPrivileged(customSchemes);
    // }

    for(let protocol of configResult.defaultProtocols)
    {
        if (process.defaultApp) {
            if (process.argv.length >= 2) {
                app.setAsDefaultProtocolClient(protocol, process.execPath, [path.resolve(process.argv[1])])
            }
        } else {
            app.setAsDefaultProtocolClient(protocol)
        }
    }

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
    app.on('ready', () =>
    {
        startApp();
    });

// Quit when all windows are closed.
    app.on('window-all-closed', () =>
    {
        //console.log('window-all-closed');
        mainWindow = null;
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (process.platform !== 'darwin')
        {
            // Windows
            // app hanging after closing all windows if started vie cmd / console
            // to avoid this: set ELECTRON_NO_ATTACH_CONSOLE=1
            // the no console output will printed to console, but the app won't hang after closing all windows
            // https://stackoverflow.com/questions/68445512/electron-app-doesnt-return-when-run-via-windows-cmd-exe
            app.quit();
        }
    });

    app.on('activate', () =>
    {
        //console.log('activate');
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (mainWindow === null)
        {
            startApp();
        }
    });

    ipcMain.handle('cdv-plugin-exec', (_, serviceName, action, args, callbackId) =>
    {
        // This function should never return a rejected promise or throw an exception, as otherwise ipcRenderer callback will convert the parameter to a string encapsulated in an Error. See https://github.com/electron/electron/issues/24427

        const callbackContext = new CordovaElectronCallbackContext(callbackId, mainWindow);

        try
        {
            Service.getService(serviceName).exec(action, args, callbackContext);
        } catch (error)
        {
            const message = "Unexpected exception while invoking service action '" + serviceName + '.' + action + "'\r\n" + error;
            console.error(message, error);
            callbackContext.error({message, error});
        }

    });

} catch (error)
{
    try
    {
        // avoid https://github.com/electron/electron/issues/40606
        console.error("cannot init cdx-electron-main.js", error);
        dialog.showErrorBox("Cannot start Cordova App", error.stack || error);
    } finally
    {
        app.exit(1);
    }
}
