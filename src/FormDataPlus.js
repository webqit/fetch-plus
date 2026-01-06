import { _before } from '@webqit/util/str/index.js';
import { _isNumeric } from '@webqit/util/js/index.js';
import { URLSearchParamsPlus } from '@webqit/url-plus';
import { dataType, _meta, _wq } from './messageParserMixin.js';

export class FormDataPlus extends FormData {

    static upgradeInPlace(formData) {
        if (formData instanceof FormDataPlus) return formData;
        return Object.setPrototypeOf(formData, FormDataPlus.prototype);
    }

    static json(data = {}, { encodeLiterals = true, meta = false } = {}) {
        const formData = new FormDataPlus;
        let isDirectlySerializable = true;

        URLSearchParamsPlus.reduceValue(data, '', (value, contextPath, suggestedKeys = undefined) => {
            if (suggestedKeys) {
                const isJson = dataType(value) === 'json';
                isDirectlySerializable = isDirectlySerializable && isJson;
                return isJson && suggestedKeys;
            }

            if (encodeLiterals && [true, false, null].includes(value)) {
                value = new Blob([value + ''], { type: 'application/json' });
            }

            formData.append(contextPath, value);
        });

        if (meta) return { result: formData, isDirectlySerializable };
        return formData;
    }

    async json({ decodeLiterals = true, meta = false } = {}) {
        let isDirectlySerializable = true;
        let json;

        for (let [name, value] of this.entries()) {
            if (!json) json = _isNumeric(_before(name, '[')) ? [] : {};

            let type = dataType(value);
            if (decodeLiterals
                && ['Blob', 'File'].includes(type)
                && value.type === 'application/json'
                && [4, 5].includes(value.size)) {
                let _value = JSON.parse(await value.text());
                if ([null, true, false].includes(_value)) {
                    value = _value;
                    type = 'json';
                }
            }

            isDirectlySerializable = isDirectlySerializable && type === 'json';
            URLSearchParamsPlus.set(json, name, value);
        }

        if (meta) return { result: json, isDirectlySerializable };
        return json;
    }
}


