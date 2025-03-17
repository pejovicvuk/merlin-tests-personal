import { HtmlControlBindableProperty } from "./html-control.js";
import { InputControl } from "./input-control.js";

const styleSheet = new CSSStyleSheet();
styleSheet.replaceSync(':host { display: inline-flex; align-items: baseline; } label { flex: 1 0 auto; }');

export class CheckBox extends InputControl implements
    HtmlControlBindableProperty<'checked', boolean | undefined> {
    static override bindableProperties = [...InputControl.bindableProperties, 'checked'];
    static override additionalAttributes = [...InputControl.additionalAttributes, 'type'];

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<input id="input" type="checkbox" part="input"><label for="input" part="label"><slot></slot></label>';
        this.input.addEventListener('change', CheckBox.#onChange);

        this.adoptStyleSheet(styleSheet);
    }

    protected get input() {
        return this.shadowRoot!.querySelector('input') as HTMLInputElement;
    }

    get checked() {
        return this.getProperty<boolean | undefined>('checked', undefined);
    }

    onCheckedChanged() {
        try {
            const checked = this.checked;
            if (typeof checked === 'boolean') {
                this.input.indeterminate = false;
                this.input.checked = checked;
            }
            else {
                this.input.indeterminate = true;
            }
        }
        catch (err) {
            this.input.indeterminate = true;
        }
    }

    #onChangeImpl() {
        this.writeToBindingSource('checked', this.input.checked);
    }

    static #onChange(ev: Event) {
        ((((ev.currentTarget as Element).parentNode) as ShadowRoot).host as CheckBox).#onChangeImpl();
    }

    override attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (name === 'type') {
            this.input.type = newValue === 'radio' ? 'radio' : 'checkbox';
        }
        else {
            super.attributeChangedCallback(name, oldValue, newValue);
        }
    }
}

