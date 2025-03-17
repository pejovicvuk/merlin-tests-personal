import { setOrRemoveAttribute } from "./bindable-control.js";
import { HtmlControlBindableProperty } from "./html-control.js";
import { InputControl } from "./input-control.js";

function stringOrNumberToStringOrNull(val: string | number | undefined | null): string | null {
    return typeof val === 'string' ? val :
        typeof val === 'number' ? val.toString() :
        val == null ? null :
        '';
}

function toStringOrErrorOrNull(text: string | undefined | null): string | null {
    return typeof text === 'string' ? text :
        text == null ? null:
        'typeof text === ' + typeof text;
}

const styleSheet = new CSSStyleSheet();
styleSheet.replaceSync(':host { display: inline-flex; flex-direction: column; } input { flex: 1 1 auto; }');

export class TextInput extends InputControl implements
    HtmlControlBindableProperty<'text', string | undefined>,
    HtmlControlBindableProperty<'hint', string | undefined>,
    HtmlControlBindableProperty<'min', string | number | undefined>,
    HtmlControlBindableProperty<'max', string | number | undefined>,
    HtmlControlBindableProperty<'step', string | number | undefined>,
    HtmlControlBindableProperty<'customValidity', string | undefined> {

    static override bindableProperties = [...InputControl.bindableProperties, 'text', 'hint', 'customValidity', 'min', 'max', 'step'];
    static override additionalAttributes = [...InputControl.additionalAttributes, 'type'];

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<input part="input">';
        this.addEventListener('input', TextInput.#onInput);
        this.adoptStyleSheet(styleSheet);
    }

    protected get input() {
        return this.shadowRoot!.querySelector('input') as HTMLInputElement;
    }

    get text() {
        return this.getProperty<string | undefined>('text');
    }

    onTextChanged() {
        try {
            this.input.value = toStringOrErrorOrNull(this.text) ?? '';
        }
        catch {
            this.input.value = '';
        }
        
        this.#checkValidity();
    }

    get hint() {
        return this.getProperty<string | undefined>('hint', undefined);
    }

    onHintChanged() {
        try {
            setOrRemoveAttribute(this.input, 'placeholder', toStringOrErrorOrNull(this.hint));
        }
        catch {
            this.input.removeAttribute('placeholder');
        }
    }

    get min() {
        return this.getProperty<string | number | undefined>('min');
    }

    onMinChanged() {
        try {
            setOrRemoveAttribute(this.input, 'min', stringOrNumberToStringOrNull(this.min));
        }
        catch {
            this.input.removeAttribute('min');
        }
        this.#checkValidity();
    }

    get max() {
        return this.getProperty<string | number | undefined>('max');
    }

    onMaxChanged() {
        try {
            setOrRemoveAttribute(this.input, 'max', stringOrNumberToStringOrNull(this.max));
        }
        catch {
            this.input.removeAttribute('max');
        }
        this.#checkValidity();
    }

    get step() {
        return this.getProperty<string | number | undefined>('step');
    }

    onStepChanged() {
        try {
            setOrRemoveAttribute(this.input, 'step', stringOrNumberToStringOrNull(this.step));
        }
        catch {
            this.input.removeAttribute('step');
        }
        this.#checkValidity();
    }

    get customValidity() {
        return this.getProperty<string | undefined>('customValidity', undefined);
    }

    onCustomValidityChanged() {
        this.#checkValidity();
    }

    #checkValidity() {
        const customError = this.customValidity;
        this.input.setCustomValidity(typeof customError === 'string' ? customError : '');
        this.input.checkValidity();
        this.writeToBindingSourceByAttribute('is-valid', this.input.validity.valid);
    }

    #onInputImpl() {
        this.writeToBindingSource('text', this.input.value);
        this.#checkValidity();
    }

    static #onInput(ev: Event) {
        (ev.currentTarget as TextInput).#onInputImpl();
    }

    override attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (name === 'is-valid') {
            this.#checkValidity();
        }
        else if (name === 'type') {
            this.input.type = newValue ?? 'text';
        }
        else if (name === 'required') {
            this.input.required = newValue != null;
        }
        else {
            super.attributeChangedCallback(name, oldValue, newValue);
        }
    }
}

