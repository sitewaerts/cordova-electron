

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
     * @param {Record<string, electron.CustomScheme>} schemes
     */
    constructor (variables, scheme, hostname, schemes) {
        super(variables, scheme, hostname);
        this.schemes = schemes
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


}
class CordovaElectronPluginInitContext extends CordovaElectronPluginContext{
    /**
     *
     * @param {Record<string, string> | null} variables
     * @param {string} scheme
     * @param {string} hostname
     * @param {(serviceName:string)=>Promise<any>} serviceLoader
     * @param {electron.BrowserWindow} mainWindow
     */
    constructor (variables, scheme, hostname, serviceLoader, mainWindow) {
        super(variables, scheme, hostname);
        this._serviceLoader = serviceLoader;
        this._mainWindow = mainWindow
    }

    /**
     * @param {string} serviceName
     * @return {Promise<any>}
     */
    getService(serviceName){
        return this._serviceLoader(serviceName);
    }

    /**
     * @return {Electron.BrowserWindow}
     */
    getMainWindow(){
        return this._mainWindow;
    }

}

module.exports = {CordovaElectronPluginConfigContext, CordovaElectronPluginInitContext};
