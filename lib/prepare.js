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
const { ConfigParser, xmlHelpers, events, CordovaError } = require('cordova-common');
const ManifestJsonParser = require('./ManifestJsonParser');
const PackageJsonParser = require('./PackageJsonParser');
const SettingJsonParser = require('./SettingJsonParser');
const BuildJsonParser = require('./BuildJsonParser');

module.exports.prepare = function (cordovaProject, options) {
    // First cleanup current config and merge project's one into own
    const defaultConfigPath = path.join(this.locations.platformRootDir, 'cordova', 'defaults.xml');
    const ownConfigPath = this.locations.configXml;
    const sourceCfg = cordovaProject.projectConfig;

    // If defaults.xml is present, overwrite platform config.xml with it.
    // Otherwise, save whatever is there as defaults, so it can be
    // restored or copy project config into platform if none exists.
    if (fs.existsSync(defaultConfigPath)) {
        this.events.emit('verbose', `Generating config.xml from defaults for platform "${this.platform}"`);
        fs.cpSync(defaultConfigPath, ownConfigPath, { recursive: true });
    } else if (fs.existsSync(ownConfigPath)) {
        this.events.emit('verbose', `Generating defaults.xml from own config.xml for platform "${this.platform}"`);
        fs.cpSync(ownConfigPath, defaultConfigPath, { recursive: true });
    } else {
        this.events.emit('verbose', `case 3 "${this.platform}"`);
        fs.cpSync(sourceCfg.path, ownConfigPath, { recursive: true });
    }

    // merge our configs
    this.config = new ConfigParser(ownConfigPath);
    xmlHelpers.mergeXml(sourceCfg.doc.getroot(), this.config.doc.getroot(), this.platform, true);
    this.config.write();

    // Update own www dir with project's www assets and plugins' assets and js-files
    this.parser.update_www(cordovaProject, this.locations);
    // Update icons
    updateIcons(cordovaProject, this.locations);
    // Update splash screens
    updateSplashScreens(cordovaProject, this.config, this.locations);

    // Copy or Create manifest.json
    const srcManifestPath = path.join(cordovaProject.locations.www, 'manifest.json');
    if (fs.existsSync(srcManifestPath)) {
        // just blindly copy it to our output/www
        // todo: validate it? ensure all properties we expect exist?
        const manifestPath = path.join(this.locations.www, 'manifest.json');
        this.events.emit('verbose', `Copying ${srcManifestPath} => ${manifestPath}`);
        fs.cpSync(srcManifestPath, manifestPath, { recursive: true });
    } else {
        const parser = new ManifestJsonParser(this.locations.www)
        this.events.emit('verbose', `Creating new manifest file in => ${parser.path}`);
        parser.configure(this.config).write();
    }

    (new PackageJsonParser(this.locations.www))
        .configure(this.config)
        .enableDevTools(options && options.options && !options.options.release)
        .write();

    const userElectronSettings = cordovaProject.projectConfig.getPlatformPreference('ElectronSettingsFilePath', 'electron') || 'res/electron/electron-settings.json';
    const userElectronSettingsPath = userElectronSettings && fs.existsSync(path.resolve(cordovaProject.root, userElectronSettings))
        ? path.resolve(cordovaProject.root, userElectronSettings)
        : undefined;

    // update Electron settings in .json file
    (new SettingJsonParser(this.locations.www))
        .configure(this.config, options.options, userElectronSettingsPath)
        .write();

    // update Electron builder settings in .json file
    (new BuildJsonParser(this.locations.www))
        .configure(this.config)
        .write();

    // update project according to config.xml changes.
    return this.parser.update_project(this.config, options)
        .then(()=>{
            if(fs.existsSync(this.locations.platformJson)){
                const platformJsonPath = path.join(this.locations.platformWww, 'electron.json');
                this.events.emit('verbose', `Copying ${this.locations.platformJson} => ${platformJsonPath}`);
                fs.cpSync(this.locations.platformJson, platformJsonPath);
            }
        });
};

/**
 * Update Electron Splash Screen image.
 */
function updateSplashScreens (cordovaProject, config, locations) {
    const splashScreens = cordovaProject.projectConfig.getSplashScreens('electron');
    const splashScreen = prepareSplashScreen(splashScreens);
    // Skip if there are no splash screens defined in config.xml
    if (!splashScreen) {
        events.emit('verbose', 'This app does not have splash screens defined.');
        return;
    }

    const resourceMap = [];
    applyIcon(resourceMap, cordovaProject, path.join(locations.www, '.cdv', 'splashScreen'), splashScreen);

    updatePathToSplashScreen(config, locations, resourceMap);

    events.emit('verbose', 'Updating splash screens');
    copyResources(cordovaProject.root, resourceMap);
}

/**
 *  Get splashScreen image. Choose only one image, if the user provided multiple.
 *  @param {Array<Icon>} splashScreens
 *  @return {OptionalIcon}
 */

function prepareSplashScreen (splashScreens) {
    /**
     * @type {OptionalIcon}
     */
    let splashScreen = null;
    /**
     * choose one icon for a target
     * @param {OptionalIcon} defaultIcon
     * @param {Icon} icon
     * @returns {Icon}
     */
    const chooseOne = (defaultIcon, icon) => {
        if (defaultIcon)
            events.emit('verbose', `Found extra splash screen: ignoring ${defaultIcon.src} in favor of ${icon.src}.`);
        return icon;
    };

    if(splashScreens) {
        for (const image of splashScreens) {
            image.extension = path.extname(image.src);
            chooseOne(splashScreen, image);
        }
    }
    return splashScreen;
}

/**
 *  Update path to Splash Screen in the config.xml
 */
function updatePathToSplashScreen (config, locations, resourceMap) {
    const elementKeys = Object.keys(resourceMap[0]);
    const splashScreenPath = resourceMap[0][elementKeys];
    const relPath = path.relative(locations.www, splashScreenPath);
    const splash = config.doc.find('splash');
    const preferences = config.doc.findall('preference'); // TODO: limit to platform electron

    splash.attrib.src = relPath;
    for (const preference of preferences) {
        if (preference.attrib.name === 'SplashScreen') {
            preference.attrib.value = relPath;
        }
    }
    config.write();
}

/**
 * Update Electron App and Installer icons.
 */
function updateIcons (cordovaProject, locations) {
    const icons = cordovaProject.projectConfig.getIcons('electron');

    // Skip if there are no app defined icons in config.xml
    if (!icons.length) {
        events.emit('verbose', 'This app does not have icons defined');
        return;
    }

    /**
     * @type {Array<Icon>}
     */
    const filteredIcons = icons.filter(icon => isValidIcon(icon));

    if (!filteredIcons.length) {
        throw new CordovaError('No icon matches the required size. Please ensure that at least one ".png" icon with dimension >= 512x512 px and a valid src attribute is specified.');
    }

    const chosenIcons = prepareIcons(filteredIcons);
    const resourceMap = createIconsResourceMap(cordovaProject, locations, chosenIcons);

    events.emit('verbose', 'Updating icons');
    copyResources(cordovaProject.root, resourceMap);
}

/**
 * @param {Icon} icon
 * @return {string}
 */
function getIconInfo (icon) {
    const values = [];
    if (icon.src)
        values.push(`src=${icon.src}`);
    if (icon.target)
        values.push(`target=${icon.target}`);
    if (icon.width)
        values.push(`height=${icon.width}`);
    if (icon.height)
        values.push(`height=${icon.height}`);
    return `{${values.join(', ')}}`
}


/**
 * Check if all required attributes are set.
 * @param {Icon} icon
 * @return {boolean}
 */
function isValidIcon (icon) {

    if (!icon.src) {
        events.emit('info', `Invalid icon ${getIconInfo(icon)} will be ignored: missing src attribute`);
        return false;
    }

    if (icon.target === 'installer') {
        if (icon.width !== undefined && icon.width !== null && icon.width < 512) {
            events.emit('info', `Invalid icon ${getIconInfo(icon)} will be ignored: invalid width`);
            return false;
        }

        if (icon.height !== undefined && icon.height !== null && icon.height < 512) {
            events.emit('info', `Invalid icon ${getIconInfo(icon)} will be ignored: invalid height`);
            return false;
        }
    }
    return true;
}

/**
 * @typedef {Object} Icon
 * @property {string} src
 * @property {'app' | 'installer' | null} [target]
 * @property {number | null} [width]
 * @property {number | null} [height]
 * @property {string | null} [suffix]
 * @property {string | null} [extension] file extension including the dot. e.g. '.png'
 */

/**
 * @typedef {Icon | null} OptionalIcon
 */

/**
 * TODO: declare and use more scopes
 * @typedef {Object.<string, IconScope>} ScopedIcons
 * @property {IconScope} [appx]
 */

/**
 * @typedef {Object.<string, Icon>} IconScope
 */

/**
 * @typedef {Object} IconSet
 * @property {OptionalIcon} [appIcon]
 * @property {OptionalIcon} [installerIcon]
 * @property {OptionalIcon} [customIcon]
 * @property {OptionalIcon} [splashScreen]
 * @property {Array<Icon>} [highResIcons]
 * @property {ScopedIcons} scopedIcons
 */


const BASE_RES = '1x';

/**
 *  Find and select icons for the app and installer.
 *  Also, set high resolution icons, if provided by user.
 *  @param {Array<Icon>} icons
 *  @return {IconSet}
 */
function prepareIcons (icons) {
    /**
     * @type {OptionalIcon}
     */
    let customIcon = null;
    /**
     * @type {OptionalIcon}
     */
    let appIcon = null;
    /**
     * @type {OptionalIcon}
     */
    let installerIcon = null;

    /**
     * choose one icon for a target
     * @param {OptionalIcon} defaultIcon
     * @param {Icon} icon
     * @returns {Icon}
     */
    const chooseOne = (defaultIcon, icon) => {
        if (defaultIcon)
            events.emit('verbose', `Found extra icon for target ${icon.target}: ignoring ${defaultIcon.src} in favor of ${icon.src}.`);
        return icon;
    };

    // check find if there are high resolution images that have DPI suffix
    const categorizedIcons = categorizeIcons(icons);
    /**
     * @type {Array<Icon>}
     */
    const highResIcons = categorizedIcons.highResIcons;
    /**
     * @type {Array<Icon>}
     */
    const remainingIcons = categorizedIcons.remainingIcons;

    // iterate over remaining icon elements to find the icons for the app and installer
    for (const icon of remainingIcons) {

        switch (icon.target)
        {
            case 'app':
                appIcon = chooseOne(appIcon, icon);
                break;
            case 'installer':
                installerIcon = chooseOne(installerIcon, icon);
                break;
            case undefined:
                if (!highResIcons.length) {
                    customIcon = chooseOne(customIcon, icon);
                }
                break;
        }
    }

    return {customIcon, appIcon, installerIcon, highResIcons, scopedIcons: categorizedIcons.scopedIcons};
}

/**
 *  Find high resolution icons, scoped icons and others
 *  @param {Array<Icon>} icons
 *  @return {{highResIcons: Array<Icon>, scopedIcons: ScopedIcons, remainingIcons: Array<Icon>}}
 */
function categorizeIcons (icons) {
    /**
     * @type {ScopedIcons}
     */
    const scopedIcons = {}

    // separate scoped icons from others
    icons = icons.filter((icon) => {
        icon.extension = path.extname(icon.src);

        if (icon.target && icon.target.indexOf(':') > 0) {
            const components = icon.target.split(':');
            const scopeName = components[0];
            const path = components[1];
            /**
             *
             * @type {IconScope}
             */
            const scope = scopedIcons[scopeName] = scopedIcons[scopeName] || {};
            if (scope[path])
                throw new Error(`icon ${path}@${scopeName} specified twice`);
            scope[path] = icon;
            icon.target = path;
            return false;
        }
        return true;
    });


    /**
     * find icons that have a target or are not in the highResIcons
     * @param {Array<Icon>} icons
     * @param {Array<Icon>} highResIcons
     * @returns {Array<Icon>}
     */
    const findRemainingIcons = (icons, highResIcons) =>
        (icons.filter((icon) => icon.target || !highResIcons.includes(icon)));

    /**
     * separate high resolution icons from others
     * @type {Array<Icon>}
     */
    const highResIcons = icons.filter(icon => {
        if (icon.src.includes('@'))
        {
            icon.suffix = icon.src.split('@').pop().slice(0, -icon.extension.length);
            return true;
        }
        return false;
    });

    /**
     * @type {Array<Icon>}
     */
    let remainingIcons = findRemainingIcons(icons, highResIcons);
    // set normal image that has standard resolution
    const has1x = highResIcons.find(obj => obj.suffix === BASE_RES);
    if (!has1x && highResIcons.length) {
        const highResIcon = highResIcons[0];
        const base = highResIcon.src.split('@')[0];
        const baseName = base + highResIcon.extension;
        const baseIcon = remainingIcons.find(obj => obj.src === baseName);

        if (!baseIcon) {
            throw new CordovaError(`Base icon for high resolution images (${baseName} or ${base + '@' + BASE_RES + highResIcon.extension}) not found.`);
        }

        baseIcon.suffix = BASE_RES;
        highResIcons.push(baseIcon);

        remainingIcons = findRemainingIcons(icons, highResIcons);
    }

    return { highResIcons, scopedIcons, remainingIcons };
}

/**
 * @param {Array} resourceMap
 * @param cordovaProject
 * @param {string} path
 * @param {OptionalIcon} sources
 * @void
 */
function applyIcon (resourceMap, cordovaProject, path, ...sources) {
    const first = sources.find(icon => !!icon);
    if (first)
        resourceMap.push(mapResources(cordovaProject.root, first.src, path + first.extension));
}

/**
 *
 * @param {Array} resourceMap
 * @param cordovaProject
 * @param {string} path
 * @param {string} extension
 * @param {OptionalIcon} sources
 * @void
 */
function applyTypedIcon(resourceMap, cordovaProject, path, extension, ...sources) {
    const first = sources.find(icon => icon?.extension === extension);
    if (first)
        resourceMap.push(mapResources(cordovaProject.root, first.src, path + first.extension));
}


/**
 * Map resources to the appropriate target directory and name.
 * @param cordovaProject
 * @param locations
 * @param {IconSet} icons
 * @return {Array}
 */
function createIconsResourceMap(cordovaProject, locations, icons) {
    const resourceMap = [];


    // TODO: validate usage specific (dimensions, extension, ...)


    // Copy common icons

    // installer icon
    applyIcon(resourceMap, cordovaProject, path.join(locations.www, 'img', 'logo'), icons.installerIcon, icons.customIcon, icons.appIcon);
    applyIcon(resourceMap, cordovaProject, path.join(locations.buildRes, 'installer'), icons.installerIcon, icons.customIcon, icons.appIcon);

    // app icon
    applyIcon(resourceMap, cordovaProject, path.join(locations.www, 'img', 'app'), icons.appIcon, icons.customIcon, icons.installerIcon);
    applyIcon(resourceMap, cordovaProject, path.join(locations.buildRes, 'icon'), icons.appIcon, icons.customIcon, icons.installerIcon); // e.g. used for Windows (NSIS), see  electron-builder/pages/icons.md

    // high resolution icons
    if (icons.highResIcons) {
        const basePath = path.join(locations.www, 'img', 'icon');
        for (let highResIcon of icons.highResIcons) {
            const targetPath = basePath + highResIcon.suffix === BASE_RES ? highResIcon.extension : `@${highResIcon.suffix}${highResIcon.extension}`;
            resourceMap.push(mapResources(cordovaProject.root, highResIcon.src, targetPath));
        }
    }


    // appx specific icons
    // see electron-builder/pages/appx.md / AppX Assets
    if (icons.scopedIcons.appx) {
        // HACK: sadly noticed that electron-builder expects custom names for some targets
        //  (see electron-builder/packages/app-builder-lib/src/targets/AppxTarget.ts)
        const appxTargetMappings = {
            Square310x310Logo: 'LargeTile',
            Square71x71Logo: 'SmallTile'
        }
        for (let target in icons.scopedIcons.appx) {
            const icon = icons.scopedIcons.appx[target];
            for(const mappingKey in appxTargetMappings) {
                if(target.indexOf(mappingKey) === 0) {
                    target = target.replace(mappingKey, appxTargetMappings[mappingKey]);
                    break;
                }
            }
            applyTypedIcon(resourceMap, cordovaProject, path.join(locations.buildRes, 'appx', target), '.png', icon);
        }
    }
    else {
        // default appx icon
        applyTypedIcon(resourceMap, cordovaProject, path.join(locations.buildRes, 'appx', 'StoreLogo'), '.png', icons.installerIcon, icons.customIcon, icons.appIcon);
    }

    // TODO: support more scopes

    return resourceMap;
}

/**
 * Get a map containing resources of a specified name (or directory) to the target directory.
 */
function mapResources (rootDir, sourcePath, targetPath) {
    return fs.existsSync(path.join(rootDir, sourcePath))
        ? { [sourcePath]: targetPath }
        : {};
}

/**
 * Copy resources to the target destination according to the resource map.
 */
function copyResources (rootDir, resourceMap) {
    resourceMap.forEach(element => {
        const elementKeys = Object.keys(element);

        if (elementKeys.length) {
            const value = elementKeys.map((e) => element[e])[0];
            fs.cpSync(path.join(rootDir, elementKeys[0]), value, { recursive: true });
        }
    });
}
