// Type definitions for Apache Cordova Electron platform
// Project: https://github.com/apache/cordova-electron
// Definitions by: Microsoft Open Technologies Inc <http://msopentech.com>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped
//
// Copyright (c) Microsoft Open Technologies, Inc.
// Licensed under the MIT license.

interface CallbackContext {
    progress (data:any):void;
    success (data?:any):void;
    error (data:any):void;
}
