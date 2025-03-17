import { HtmlControl, HtmlControlBindableProperty } from "./html-control.js";

export class TextBlock extends HtmlControl implements HtmlControlBindableProperty<'text', any> {
    static override bindableProperties = [...HtmlControl.bindableProperties, 'text'];

    constructor() {
        super();
        this.attachShadow({mode: "open"});
    }

    get text() {
        return this.getProperty<string | undefined>('text', undefined);
    }

    onTextChanged() {
        const shadow = this.shadowRoot!;
        try {
            const text = '' + this.text;
            shadow.textContent = text === '' ? ' ' : text;
        }
        catch (err) {
            const text = '' + err;
            shadow.textContent = text === '' ? ' ' : text;
        }
    }
}

