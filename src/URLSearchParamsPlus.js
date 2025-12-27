import { _isString, _isNumeric, _isTypeObject } from '@webqit/util/js/index.js';

export class URLSearchParamsPlus extends URLSearchParams {

    // Parse a search params string into an object
    static eval(targetObject, str, delim = '&') {
        str = str || '';
        (str.startsWith('?') ? str.substr(1) : str)
            .split(delim).filter(q => q).map(q => q.split('=').map(q => q.trim()))
            .forEach(q => this.set(targetObject, q[0], decodeURIComponent(q[1])));
        return targetObject;
    }

    // Stringify an object into a search params string
    static stringify(targetObject, delim = '&') {
        const q = [];
        Object.keys(targetObject).forEach(key => {
            this.reduceValue(targetObject[key], key, (_value, _pathNotation, suggestedKeys = undefined) => {
                if (suggestedKeys) return suggestedKeys;
                q.push(`${_pathNotation}=${encodeURIComponent(_value)}`);
            });
        });
        return q.join(delim);
    }

    // Get value by path notation
    static get(targetObject, pathNotation) {
        return this.reducePath(pathNotation, targetObject, (key, _targetObject) => {
            if (!_targetObject && _targetObject !== 0) return;
            return _targetObject[key];
        });
    }

    // Set value by path notation
    static set(targetObject, pathNotation, value) {
        this.reducePath(pathNotation, targetObject, function(_key, _targetObject, suggestedBranch = undefined) {
            let _value = value;
            if (suggestedBranch) { _value = suggestedBranch; }
            if (_key === '' && Array.isArray(_targetObject)) {
                _targetObject.push(_value);
            } else {
                _targetObject[_key] = _value;
            }
            return _value;
        });
    }
    
    // Resolve a value to its leaf nodes
    static reduceValue(value, contextPath, callback) {
        if (_isTypeObject(value)) {
            let suggestedKeys = Object.keys(value);
            let keys = callback(value, contextPath, suggestedKeys);
            if (Array.isArray(keys)) {
                return keys.forEach(key => {
                    this.reduceValue(value[key], contextPath ? `${contextPath}[${key}]` : key, callback);
                });
            }
        }
        callback(value, contextPath);
    }

    // Resolve a path to its leaf index
    static reducePath(pathNotation, contextObject, callback) {
        if (_isString(pathNotation) && pathNotation.endsWith(']') && _isTypeObject(contextObject)) {
            let [ key, ...rest ] = pathNotation.split('[');
            if (_isNumeric(key)) { key = parseInt(key); }
            rest = rest.join('[').replace(']', '');
            let branch;
            if (key in contextObject) {
                branch = contextObject[key];
            } else {
                let suggestedBranch = rest === '' || _isNumeric(rest.split('[')[0]) ? [] : {};
                branch = callback(key, contextObject, suggestedBranch);
            }
            return this.reducePath(rest, branch, callback);
        }
        if (_isNumeric(pathNotation)) { pathNotation = parseInt(pathNotation); }
        return callback(pathNotation, contextObject);
    }
}
