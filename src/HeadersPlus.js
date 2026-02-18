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
            const _after = (str, prefix) => str.includes(prefix) ? str.split(prefix)[1] : str;

            value = !value ? [] : _after(value, 'bytes=').split(',').map((rangeStr) => {
                if (!rangeStr.includes('-')) rangeStr = '-'; // -> [null, null];

                // "0-499" -> [0, 499] | "500-" -> [500, null] | "-500" -> [null, 500]
                const range = rangeStr.trim().split('-').map((s) => (s.length > 0 ? parseInt(s, 10) : null));

                range.resolveAgainst = (totalLength) => {
                    const offsets = [...range]; // Clone the [start, end] array

                    // 1. Handle Suffix Ranges (e.g., bytes=-500)
                    if (offsets[0] === null && offsets[1] !== null) {
                        offsets[0] = Math.max(0, totalLength - offsets[1]);
                        offsets[1] = totalLength - 1;
                    }
                    // 2. Handle Open-ended Ranges (e.g., bytes=500-)
                    else if (offsets[0] !== null && offsets[1] === null) {
                        offsets[1] = totalLength - 1;
                    }
                    // 3. Handle Normal Ranges (e.g., bytes=0-499)
                    else if (offsets[0] !== null && offsets[1] !== null) {
                        offsets[1] = Math.min(offsets[1], totalLength - 1);
                    }

                    return offsets; // Returns [start, end] where both are inclusive indices
                };

                range.canResolveAgainst = (currentStart, totalLength) => {
                    const resolved = range.resolveAgainst(totalLength);

                    // 1. Check for NaN or unparsed nulls (invalid formats)
                    if (Number.isNaN(resolved[0]) || Number.isNaN(resolved[1]) || resolved[0] === null || resolved[1] === null) {
                        return false;
                    }

                    // 2. Validate start (end is always clamped): 
                    // - Range cannot be inverted (start > end)
                    // - Start cannot be beyond file length
                    // - Start cannot be below file start
                    if (resolved[0] > resolved[1] || resolved[0] >= totalLength || resolved[0] < currentStart) {
                        return false;
                    }

                    return true;
                };

                range.toString = () => rangeStr;

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

