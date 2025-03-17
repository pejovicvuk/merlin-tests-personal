import { HtmlControlBindableProperty } from "./html-control.js";
import { InputControl } from "./input-control.js";

const styleSheet = new CSSStyleSheet();
styleSheet.replaceSync(':host { display: inline-flex; align-items: baseline; } label { flex: 1 0 auto; }');

export class RadioButton extends InputControl implements
    HtmlControlBindableProperty<'value', any | undefined>, 
    HtmlControlBindableProperty<'option', any | undefined> {
    
    static override bindableProperties = [...InputControl.bindableProperties, 'value', 'option'];

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<input id="input" type="radio" part="input"><label for="input" part="label"><slot></slot></label>';
        this.input.addEventListener('change', RadioButton.#onChange);

        this.adoptStyleSheet(styleSheet);
    }

    protected get input() {
        return this.shadowRoot!.querySelector('input') as HTMLInputElement;
    }

    get value() {
        return this.getProperty<boolean | undefined>('value', undefined);
    }

    #evaluate() {
        try {
            this.input.indeterminate = false;
            this.input.checked = this.value === this.option;
        }
        catch (err) {
            this.input.indeterminate = true;
        }
    }

    onValueChanged() {
        this.#evaluate();
    }

    get option() {
        return this.getProperty<boolean | undefined>('option', undefined);
    }

    onOptionChanged() {
        this.#evaluate
    }

    #onChangeImpl() {
        if (this.input.checked) {
            this.writeToBindingSource('value', this.option);
        }
    }

    static #onChange(ev: Event) {
        ((((ev.currentTarget as Element).parentNode) as ShadowRoot).host as RadioButton).#onChangeImpl();
    }
}

