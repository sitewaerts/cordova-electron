

class CordovaElectronPluginContext {
    /**
     *
     * @param {Record<string, string> | null} variables
     * @param {string} scheme
     * @param {string} hostname
     */
    constructor (variables, scheme, hostname) {
        this._variables = variables || {};
        this._scheme = scheme;
        this._hostname = hostname;
    }

    getPackageName(){
        return this._variables['PACKAGE_NAME']
    }

    getScheme(){
        return this._scheme;
    }

    getHostname(){
        return this._hostname;
    }


    /**
     *
     * @param {string} key
     * @return {string}
     */
    getVariable(key){
        return this._variables[key];
    }

}

class CordovaElectronPluginConfigContext extends CordovaElectronPluginContext{
    /**
     *
     * @param {Record<string, string> | null} variables
     * @param {string} scheme
     * @param {string} hostname
     * @param {electron.App} app
     * @param {Record<string, electron.CustomScheme>} schemes
     * @param {Array<string>} defaultProtocols
     */
    constructor (variables, scheme, hostname, app, schemes, defaultProtocols) {
        super(variables, scheme, hostname);
        this._app = app
        this.schemes = schemes
        this.defaultProtocols = defaultProtocols
    }

    /**
     * @return {Electron.App}
     */
    getApp(){
        return this._app;
    }


    /**
     * @param {electron.CustomScheme} customScheme
     * @void
     */

    registerSchemeAsPrivileged(customScheme){
        if(this.schemes[customScheme.scheme])
            console.warn("overriding custom scheme '" + customScheme + "'");
        this.schemes[customScheme.scheme] = customScheme;
    }

    /**
     *
     * @param {string} scheme
     * @void
     */
    registerAsDefaultProtocolClient(scheme){
        if(this.defaultProtocols.indexOf(scheme)<0)
            this.defaultProtocols.push(scheme);
    }


}
class CordovaElectronPluginInitContext extends CordovaElectronPluginContext{
    /**
     *
     * @param {Record<string, string> | null} variables
     * @param {string} scheme
     * @param {string} hostname
     * @param {(serviceName:string)=>Promise<any>} serviceLoader
     * @param {electron.BrowserWindow} mainWindow
     * @param {electron.App} app
     */
    constructor (variables, scheme, hostname, serviceLoader, mainWindow, app) {
        super(variables, scheme, hostname);
        this._serviceLoader = serviceLoader;
        this._mainWindow = mainWindow
        this._app = app
    }

    /**
     * @param {string} serviceName
     * @return {Promise<any>}
     */
    getService(serviceName){
        return this._serviceLoader(serviceName);
    }

    /**
     * @return {Electron.App}
     */
    getApp(){
        return this._app;
    }

    /**
     * @return {Electron.BrowserWindow}
     */
    getMainWindow(){
        return this._mainWindow;
    }

}

module.exports = {CordovaElectronPluginConfigContext, CordovaElectronPluginInitContext};
