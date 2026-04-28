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
const semver = require('semver')
// const semverLt = require('semver/functions/lt')

// see electron-builder/packages/app-builder-lib/src/targets/AppxTarget.ts
// TODO: support more capabilities
const CAPABILITIES = [
    'internetClient',
    'internetClientServer',
    'privateNetworkClientServer',
    'backgroundMediaPlayback',
    'musicLibrary',
    'picturesLibrary',
    'videosLibrary',
    'contacts',
    'removableStorage',
    'location',
    'microphone',
    'webcam',
    'proximity'
];

const support = {
    SigntoolOptions : semver.gte(require('electron-builder/package.json').version, '25.0.0'),
    Capabilities : semver.gte(require('electron-builder/package.json').version, '26.3.6')
}

function _isCapabilityEnabled(config, name)
{
    const v = config.getPreference('WindowsCapability.' + name, 'electron');
    return v === 'true';
}

class BuildJsonParser {
    constructor (wwwDir) {
        this.path = path.join(wwwDir, '../build.json');
        if(fs.existsSync(this.path))
            this.buildJson = require(this.path);
        else
            this.buildJson = {};
        this.buildJson.config = this.buildJson.config || {};
    }

    configure (config) {
        // see electron-builder/packages/app-builder-lib/scheme.json

        // const windows = this.buildJson.config.win = this.buildJson.config.win || {};

        // https://www.electron.build/appx.html
        const appx = this.buildJson.config.appx = this.buildJson.config.appx || {};


        if(config.getPreference('WindowsStoreIdentityName', 'electron'))
            appx.identityName = config.getPreference('WindowsStoreIdentityName', 'electron');


        if(support.Capabilities)
        {
            // new electron-builder API
            const windowsCapabilities = appx.capabilities || [];
            for(const cap of CAPABILITIES)
            {
                if(windowsCapabilities.indexOf(cap) < 0 && _isCapabilityEnabled(config, cap))
                    windowsCapabilities.push(cap);
            }
            if(windowsCapabilities.length > 0)
                appx.capabilities = windowsCapabilities;
        }


        const locales = config.getPreference('locales', 'electron');
        if(locales)
        {
            // TODO apply to other configs as well
            //  - win NSIS, etc. ??
            //  - mac CFBundleLocalizations ??
            //  - linux ...

            const windowsLanguages = appx.languages || [];
            for(let locale of locales.split(","))
            {
                if(!locale)
                    continue;
                locale = locale.trim();
                if(windowsLanguages.indexOf(locale)<0)
                    windowsLanguages.push(locale);
            }
            if(windowsLanguages.length > 0)
                appx.languages = windowsLanguages;
        }

        if(config.getPreference('WindowsTileShowNameOnTiles', 'electron') === 'true')
            appx.showNameOnTiles = true;

        if(config.getPreference('WindowsTileBackgroundColor', 'electron'))
            appx.backgroundColor = config.getPreference('WindowsTileBackgroundColor', 'electron');


        return this;
    }

    write () {
        fs.writeFileSync(this.path, JSON.stringify(this.buildJson, null, 2), 'utf8');
    }
}


BuildJsonParser.support = support;

module.exports = BuildJsonParser;
