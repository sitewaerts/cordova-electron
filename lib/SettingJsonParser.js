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

const fs = require('node:fs');
const path = require('node:path');
const { deepMerge } = require('./util');

class SettingJsonParser {
    constructor (wwwDir) {
        this.path = path.join(wwwDir, 'cdv-electron-settings.json');
        this.package = require(this.path);
    }

    configure (config, options, userElectronSettingsPath) {
        // Set loadURL path from config.xml or fallback to index.html
        const contentNode = config.doc.find('content');
        const contentSrc = (contentNode && contentNode.attrib.src) || 'index.html';

        this.package.browserWindowInstance = {
            loadURL: {
                url: contentSrc
            }
        };

        // Apply user settings from www/cdv-electron-settings.json
        if (userElectronSettingsPath) {
            deepMerge(this.package, require(userElectronSettingsPath));
        }

        this.package.browserWindow = this.package.browserWindow || {};
        this.package.browserWindow.webPreferences = this.package.browserWindow.webPreferences || {};

        if (options) {
            this.package.browserWindow.webPreferences.devTools = !options.release;
        }

        // Apply settings from config.xml

        this.package.browserWindow.fullscreen = config.getPreference('fullscreen', 'electron') === 'true';

        this.package.scheme = config.getPreference('scheme', 'electron') || 'file';
        this.package.hostname = config.getPreference('hostname', 'electron') || 'localhost';

        const overrideUserAgent = config.getPreference('OverrideUserAgent', 'electron');
        if(overrideUserAgent)
        {
            delete this.package.appendUserAgent;
            this.package.overrideUserAgent = overrideUserAgent;
        }
        else{
            const appendUserAgent = config.getPreference('AppendUserAgent', 'electron');
            if(appendUserAgent)
            {
                delete this.package.overrideUserAgent;
                this.package.appendUserAgent = appendUserAgent;
            }
        }


        return this;
    }

    write () {
        fs.writeFileSync(this.path, JSON.stringify(this.package, null, 2), 'utf8');
    }
}

module.exports = SettingJsonParser;
