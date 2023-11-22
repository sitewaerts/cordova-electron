// Type definitions for Apache Cordova Electron platform
// Project: https://github.com/apache/cordova-electron
// Definitions by: Microsoft Open Technologies Inc <http://msopentech.com>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped
//
// Copyright (c) Microsoft Open Technologies, Inc.
// Licensed under the MIT license.

/// <reference types="electron" />

import * as electron from "electron";

interface CordovaElectronCallbackContext {

    /**
     * send progress data to caller
     * execution continues until success() oor error() get called
     */
    progress(data: any): void;

    /**
     * finish execution with success value
     */
    success(data?: any): void;

    /**
     * finish execution with error value
     */
    error(data: any): void;
}

interface CordovaElectronPluginContext {

    /**
     * package id (e.g. org.apache.cordova.sample) of the cordova app
     */
    getPackageName(): string

    /**
     * scheme used to access embedded sources in www folder
     */
    getScheme(): string

    /**
     * hostname used to build urls with the above scheme
     */
    getHostname(): string

    /**
     *
     * access to variables defined at plugin deployment
     */
    getVariable(key: string): string

}

interface CordovaElectronPluginConfigContext extends CordovaElectronPluginContext {

    registerSchemeAsPrivileged(customScheme: electron.CustomScheme): void

}

interface CordovaElectronPluginInitContext extends CordovaElectronPluginContext {

    /**
     * lookup a plugin instance
     */
    getService(serviceName: string): Promise<any>

    /**
     * access to the apps main window
     */
    getMainWindow(): Electron.BrowserWindow

}


/**
 * execute action on plugin instance
 * @returns {boolean} indicating if given action is available in plugin
 */
type CordovaElectronPluginExec =
    (action: string, args: Array<any>, callbackContext: CordovaElectronCallbackContext) => boolean

interface CordovaElectronPluginConf {
    /**
     * configure plugin before 'ready' event is fired
     * plugin may use electron main process apis which must be called before 'ready' event is fired
     * plugin may apply plugin-variables defined at deploy time
     */
    configure?: (ctx: CordovaElectronPluginConfigContext) => void
}

interface CordovaElectronPluginInit {
    /**
     * initialize plugin after 'ready' event is fired and before the first call to the plugin api is performed
     * plugin may apply plugin-variables defined at deploy time
     * plugin may link to other plugin instances
     */
    initialize?: (ctx: CordovaElectronPluginInitContext) => Promise<void> | void
}

type CordovaElectronPlugin = CordovaElectronPluginExec & CordovaElectronPluginConf & CordovaElectronPluginInit
