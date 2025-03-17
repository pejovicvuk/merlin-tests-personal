import { HtmlControl, HtmlControlBindableProperty } from "./html-control.js";

export class PickSlot extends HtmlControl implements HtmlControlBindableProperty<'case', string | undefined> {
    static override bindableProperties = [...HtmlControl.bindableProperties, 'case'];

    constructor() {
        super();

        const shadow = this.attachShadow({ mode:"open" });
        shadow.innerHTML = '<slot name="undecided"></slot>'
    }

    get case() {
        return this.getProperty<string | undefined>('case', undefined);
    }

    onCaseChanged() {
        const slot = this.shadowRoot!.querySelector('slot')!;
        try {
            const cs = this.case;
            if (typeof cs === 'string') {
                slot.name = cs;
            }
            else {
                slot.name = 'undecided';
            }
        }
        catch (err) {
            slot.name = 'error';
        }
    }
}