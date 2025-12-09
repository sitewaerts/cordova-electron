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

const path = require('node:path');
const fs = require('node:fs');
const execa = require('execa');
const { events } = require('cordova-common');
const PackageJsonParser = require("./PackageJsonParser");

module.exports = {
    www_dir: (project_dir) => path.join(project_dir, 'www'),
    package_name: (project_dir) => {
        // this method should the id from root config.xml => <widget id=xxx
        // return common.package_name(project_dir, this.www_dir(project_dir));
        let pkgName = 'io.cordova.hellocordova';
        const widget_id_regex = /(?:<widget[^>]*\s+id=['"])([^'"]+)(?:['"])/;
        const configPath = path.join(project_dir, 'config.xml');

        if (fs.existsSync(configPath)) {
            const configStr = fs.readFileSync(configPath, 'utf8');
            const res = configStr.match(widget_id_regex);

            if (res && res.length > 1) {
                pkgName = res[1];
            }
        }

        return pkgName;
    },
    'js-module': {
        install: (jsModule, plugin_dir, plugin_id, www_dir) => {
            // Copy the plugin's files into the www directory.
            const moduleSource = path.resolve(plugin_dir, jsModule.src);
            // Get module name based on existing 'name' attribute or filename
            // Must use path.extname/path.basename instead of path.parse due to CB-9981
            const moduleName = `${plugin_id}.${jsModule.name || path.basename(jsModule.src, path.extname(jsModule.src))}`;

            // Read in the file, prepend the cordova.define, and write it back out.
            let scriptContent = fs.readFileSync(moduleSource, 'utf8').replace(/^\ufeff/, ''); // Window BOM

            if (moduleSource.match(/.*\.json$/)) {
                scriptContent = `module.exports =  + ${scriptContent}`;
            }

            scriptContent = `cordova.define('${moduleName}', function (require, exports, module) {
                ${scriptContent}
            });`;

            const moduleDestination = path.resolve(www_dir, 'plugins', plugin_id, jsModule.src);

            fs.mkdirSync(path.dirname(moduleDestination), { recursive: true });
            fs.writeFileSync(moduleDestination, scriptContent, 'utf8');
        },
        uninstall: (jsModule, www_dir, plugin_id) => {
            fs.rmSync(path.join(www_dir, 'plugins', plugin_id), { recursive: true, force: true });
            const pluginRelativePath = path.join('plugins', plugin_id, jsModule.src);
            // common.removeFileAndParents(www_dir, pluginRelativePath);
            events.emit('verbose', `js-module uninstall called : ${pluginRelativePath}`);
        }
    },
    'source-file': {
        install: (obj, plugin_dir, project_dir, plugin_id, options) => {
            // var dest = path.join(obj.targetDir, path.basename(obj.src));
            // common.copyFile(plugin_dir, obj.src, project_dir, dest);
            events.emit('verbose', 'source-file.install is not supported for electron');
        },
        uninstall: (obj, plugin_dir, project_dir, plugin_id, options) => {
            // var dest = path.join(obj.targetDir, path.basename(obj.src));
            // common.removeFile(project_dir, dest);
            events.emit('verbose', 'source-file.uninstall is not supported for electron');
        }
    },
    'header-file': {
        install: (obj, plugin_dir, project_dir, plugin_id, options) => {
            events.emit('verbose', 'header-file.install is not supported for electron');
        },
        uninstall: (obj, plugin_dir, project_dir, plugin_id, options) => {
            events.emit('verbose', 'header-file.uninstall is not supported for electron');
        }
    },
    'resource-file': {
        install: (obj, plugin_dir, project_dir, plugin_id, options) => {
            events.emit('verbose', 'resource-file.install is not supported for electron');
        },
        uninstall: (obj, plugin_dir, project_dir, plugin_id, options) => {
            events.emit('verbose', 'resource-file.uninstall is not supported for electron');
        }
    },
    framework: {
        install: (obj, plugin_dir, project_dir, plugin_id, options) => {
            const electronPluginSrc = path.resolve(plugin_dir, obj.src);

            if (!fs.existsSync(electronPluginSrc)) {
                events.emit(
                    'warn',
                    '[Cordova Electron] The defined "framework" source path does not exist and can not be installed. ' + electronPluginSrc
                );
                return;
            }

            const wwwDir = path.join(project_dir, 'www');

            // First: Install the Cordova Electron plugin dependencies
            execa.sync('npm', ['install'], {
                cwd: electronPluginSrc
            });

            // Second: Install the Cordova Electron plugin to the Electron app scope. (npm 8 creates symlink)
            execa.sync('npm', ['install', electronPluginSrc], {
                cwd: wwwDir
            });

            const pluginPackage = JSON.parse(fs.readFileSync(path.join(electronPluginSrc, 'package.json'), 'utf8'));
            if (!pluginPackage.cordova || !pluginPackage.cordova.serviceName)
                return;
            const serviceName = pluginPackage.cordova.serviceName;

            const appPackage = new PackageJsonParser(wwwDir)
            const existingService = appPackage.getService(serviceName);

            if (existingService) {
                events.emit(
                    'warn',
                    `[Cordova Electron] The service name "${serviceName}" is already taken by "${existingService.pluginId}" and can not be redeclared.`
                );
                return;
            }

            appPackage.addService({
                serviceName: serviceName,
                pluginId: plugin_id,
                electronModule: pluginPackage.name
            });

            appPackage.write();
        },
        uninstall: (obj, plugin_dir, project_dir, plugin_id, options) => {
            const electronPluginPackageFile = path.resolve(plugin_dir, obj.src, 'package.json');
            const electronPluginPackage = JSON.parse(
                fs.readFileSync(electronPluginPackageFile, 'utf8')
            );

            const electronPluginName = electronPluginPackage.name;
            const wwwDir = path.join(project_dir, 'www');

            execa.sync('npm', ['uninstall', electronPluginName], {
                cwd: wwwDir
            });

            const appPackage = new PackageJsonParser(wwwDir);
            const removed = appPackage.removeServiceByModule(electronPluginName);
            if(removed)
            {
                events.emit(
                    'verbose',
                    `[Cordova Electron] The service name "${removed.serviceName}" was delinked.`
                );
                appPackage.write();
            }
        }
    },
    'lib-file': {
        install: (obj, plugin_dir, project_dir, plugin_id, options) => {
            events.emit('verbose', 'lib-file.install is not supported for electron');
        },
        uninstall: (obj, plugin_dir, project_dir, plugin_id, options) => {
            events.emit('verbose', 'lib-file.uninstall is not supported for electron');
        }
    },
    asset: {
        install: (asset, plugin_dir, wwwDest) => {
            const src = path.join(plugin_dir, asset.src);
            const dest = path.join(wwwDest, asset.target);
            const destDir = path.parse(dest).dir;

            fs.mkdirSync(destDir, { recursive: true });
            fs.cpSync(src, dest, { recursive: true });
        },
        uninstall: (asset, wwwDest, plugin_id) => {
            fs.rmSync(path.join(wwwDest, asset.target), { recursive: true, force: true });
            fs.rmSync(path.join(wwwDest, 'plugins', plugin_id), { recursive: true, force: true });
        }
    }
};
