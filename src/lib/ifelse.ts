import { HtmlControl, HtmlControlBindableProperty } from "./html-control.js";


const styleSheet = new CSSStyleSheet();
styleSheet.replaceSync(`
    :host { display: contents; }
`);

export class IfElse extends HtmlControl implements HtmlControlBindableProperty<'condition', boolean | undefined> {
    static override bindableProperties = [...HtmlControl.bindableProperties, 'condition'];

    constructor() {
        super();

        const shadow = this.attachShadow({ mode:"open" });
        shadow.innerHTML = '<slot name="undecided"></slot>'

        this.adoptStyleSheet(styleSheet);
    }

    get condition() {
        return this.getProperty<boolean | undefined>('condition', undefined);
    }

    onConditionChanged() {
        const slot = this.shadowRoot!.querySelector('slot')!;
        try {
            const condition = this.condition === true;
            if (typeof condition === 'boolean') {
                slot.name = condition ? 'true' : 'false';
            }
            else {
                slot.name = 'not a boolean';
            }
        }
        catch (err) {
            slot.name = 'error';
        }
    }
}