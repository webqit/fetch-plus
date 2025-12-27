import { _before } from '@webqit/util/str/index.js';
import { _isNumeric } from '@webqit/util/js/index.js';
import { URLSearchParamsPlus } from './URLSearchParamsPlus.js';
import { dataType, _meta, _wq } from './core.js';

export class FormDataPlus extends FormData {

    static upgradeInPlace(formData) {
        Object.setPrototypeOf(formData, FormDataPlus.prototype);
    }

    static json(data = {}, { recursive = true, getIsJsonfiable = false } = {}) {
        const formData = new FormDataPlus;
        let isJsonfiable = true;

        URLSearchParamsPlus.reduceValue(data, '', (value, contextPath, suggestedKeys = undefined) => {
            if (suggestedKeys) {
                const isJson = dataType(value) === 'json';
                isJsonfiable = isJsonfiable && isJson;
                return isJson && suggestedKeys;
            }

            if (recursive && [true, false, null].includes(value)) {
                value = new Blob([value + ''], { type: 'application/json' });
            }

            formData.append(contextPath, value);
        });

        if (getIsJsonfiable) return [formData, isJsonfiable];
        return formData;
    }

    async json({ recursive = true, getIsJsonfiable = false } = {}) {
        let isJsonfiable = true;
        let json;

        for (let [name, value] of this.entries()) {
            if (!json) json = _isNumeric(_before(name, '[')) ? [] : {};

            let type = dataType(value);
            if (recursive && ['Blob', 'File'].includes(type) && value.type === 'application/json') {
                let _value = await value.text();
                value = JSON.parse(_value);
                type = 'json';
            }

            isJsonfiable = isJsonfiable && type === 'json';
            URLSearchParamsPlus.set(json, name, value);
        }

        if (getIsJsonfiable) return [json, isJsonfiable];
        return json;
    }
}


