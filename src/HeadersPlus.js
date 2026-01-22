import { _isObject, _isTypeObject } from '@webqit/util/js/index.js';
import { _from as _arrFrom } from '@webqit/util/arr/index.js';
import { _after } from '@webqit/util/str/index.js';

export class HeadersPlus extends Headers {

    static upgradeInPlace(headers) {
        if (headers instanceof HeadersPlus) return headers;
        return Object.setPrototypeOf(headers, HeadersPlus.prototype);
    }

    set(name, value) {
        // Format "Set-Cookie" response header
        if (/^Set-Cookie$/i.test(name)) {
            if (Array.isArray(value)) {
                this.delete(name); // IMPORTANT
                for (const v of value) this.append(name, v);
                return;
            }
            if (_isObject(value)) {
                value = renderCookieObjToString(value);
            }
        }

        // Format "Cookie" request header
        if (/Cookie/i.test(name)) {
            value = renderCookieInput(value);
        }

        // Format "Content-Range" response header?
        if (/^Content-Range$/i.test(name)) {
            value = renderContentRangeInput(value);
        }

        // Format "Range" request header?
        if (/^Range$/i.test(name)) {
            value = renderRangeInput(value);
        }

        // Format "Accept" request header?
        if (/^Accept$/i.test(name)) {
            value = renderAcceptInput(value);
        }

        return super.set(name, value);
    }

    append(name, value) {
        // Format "Set-Cookie" response header
        if (/^Set-Cookie$/i.test(name)) {
            if (Array.isArray(value)) {
                for (const v of value) this.append(name, v);
                return;
            }
            if (_isObject(value)) {
                value = renderCookieObjToString(value);
            }
        }

        // Format "Cookie" request header
        if (/Cookie/i.test(name)) {
            value = renderCookieInput(value);
        }

        // Format "Content-Range" response header?
        if (/^Content-Range$/i.test(name)) {
            value = renderContentRangeInput(value);
        }

        // Format "Range" request header?
        if (/^Range$/i.test(name)) {
            value = renderRangeInput(value);
        }

        // Format "Accept" request header?
        if (/^Accept$/i.test(name)) {
            value = renderAcceptInput(value);
        }

        return super.append(name, value);
    }

    get(name, structured = false) {
        let value = super.get(name);

        // Parse "Set-Cookie" response header
        if (/^Set-Cookie$/i.test(name) && structured) {
            value = this.getSetCookie()/*IMPORTANT*/.map((str) => {
                const [cookieDefinition, ...attrs] = str.split(';');
                const [name, value] = cookieDefinition.split('=').map((s) => s.trim());
                const cookieObj = { name, value: /*decodeURIComponent*/(value), };
                attrs.map((attrStr) => attrStr.trim().split('=')).forEach(attrsArr => {
                    cookieObj[attrsArr[0][0].toLowerCase() + attrsArr[0].substring(1).replace('-', '')] = attrsArr.length === 1 ? true : attrsArr[1];
                });
                return cookieObj;
            });
        }

        // Parse "Cookie" request header
        if (/^Cookie$/i.test(name) && structured) {
            value = value?.split(';').map((str) => {
                const [name, value] = str.split('=').map((s) => s.trim());
                return { name, value: /*decodeURIComponent*/(value), };
            }) || [];
        }

        // Parse "Content-Range" response header?
        if (/^Content-Range$/i.test(name) && value && structured) {
            value = _after(value, 'bytes ').split('/');
        }

        // Parse "Range" request header?
        if (/^Range$/i.test(name) && structured) {
            value = !value ? [] : _after(value, 'bytes=').split(',').map((rangeStr) => {
                const range = rangeStr.trim().split('-').map((s) => s ? parseInt(s, 10) : null);
                range.resolveAgainst = (totalLength) => {
                    const offsets = [...range];
                    if (offsets[1] === null) {
                        offsets[1] = totalLength - 1;
                    } else {
                        offsets[1] = Math.min(offsets[1], totalLength) - 1;
                    }
                    if (offsets[0] === null) {
                        offsets[0] = offsets[1] ? totalLength - offsets[1] - 1 : 0;
                    }
                    return offsets;
                };
                range.canResolveAgainst = (currentStart, totalLength) => {
                    const offsets = [
                        typeof range[0] === 'number' ? range[0] : currentStart,
                        typeof range[1] === 'number' ? range[1] : totalLength - 1
                    ];
                    // Start higher than end or vice versa?
                    if (offsets[0] > offsets[1]) return false;
                    // Stretching beyond valid start/end?
                    if (offsets[0] < currentStart || offsets[1] >= totalLength) return false;
                    return true;
                };
                range.toString = () => {
                    return rangeStr;
                };
                return range;
            });
        }

        // Parse "Accept" request header?
        if (/^Accept$/i.test(name) && value && structured) {
            const parseSpec = (spec) => {
                const [mime, q] = spec.trim().split(';').map((s) => s.trim());
                return [mime, parseFloat((q || 'q=1').replace('q=', ''))];
            };
            const $value = value;
            value = value.split(',')
                .map((spec) => parseSpec(spec))
                .sort((a, b) => a[1] > b[1] ? -1 : 1) || [];
            value.match = (mime) => {
                if (!mime) return 0;
                const splitMime = (mime) => mime.split('/').map((s) => s.trim());
                const $mime = splitMime(mime + '');
                return value.reduce((prev, [entry, q]) => {
                    if (prev) return prev;
                    const $entry = splitMime(entry);
                    return [0, 1].every((i) => (($mime[i] === $entry[i]) || $mime[i] === '*' || $entry[i] === '*')) ? q : 0;
                }, 0);
            };
            value.toString = () => {
                return $value;
            };
        }

        return value;
    }
}

export function renderCookieObjToString(cookieObj) {
    const attrsArr = [`${cookieObj.name}=${/*encodeURIComponent*/(cookieObj.value)}`];
    for (const attrName in cookieObj) {
        if (['name', 'value'].includes(attrName)) continue;

        let _attrName = attrName[0].toUpperCase() + attrName.substring(1);
        if (_attrName === 'MaxAge') { _attrName = 'Max-Age' };

        if (cookieObj[attrName] === false) continue;
        attrsArr.push(cookieObj[attrName] === true ? _attrName : `${_attrName}=${cookieObj[attrName]}`);
    }
    return attrsArr.join('; ');
}

function renderCookieInput(value) {
    if (_isTypeObject(value)) {
        value = [].concat(value).map(renderCookieObjToString).join('; ');
    }
    return value;
}

function renderRangeInput(value) {
    let rangeArr = [];
    _arrFrom(value).forEach((range, i) => {
        let rangeStr = Array.isArray(range) ? range.map((n) => [null, undefined].includes(n) ? '' : n).join('-') : range + '';
        if (i === 0 && !rangeStr.includes('bytes=')) {
            rangeStr = `bytes=${rangeStr}`;
        }
        rangeArr.push(rangeStr);
    });
    return rangeArr.join(', ');
}

function renderContentRangeInput(value) {
    if (Array.isArray(value)) {
        if (value.length < 2 || !value[0].includes('-')) {
            throw new Error(`A Content-Range array must be in the format: [ 'start-end', 'total' ]`);
        }
        value = `bytes ${value.join('/')}`;
    }
    return value;
}

function renderAcceptInput(value) {
    if (Array.isArray(value)) {
        value = value.map(
            (s) => Array.isArray(s) ? s.map(
                (s, i) => i === 1 && (s = parseFloat(s), true) ? (s === 1 ? '' : `;q=${s}`) : s.trim()
            ).join('') : s.trim()
        ).join(',');
    }
    return value;
}

