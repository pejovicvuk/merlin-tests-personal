import { HtmlControl } from "./html-control.js";

const styleSheet = new CSSStyleSheet();
styleSheet.replaceSync(`
    :host {
        border: 1px solid ButtonBorder;
        background-color: ButtonFace;
        color: ButtonText;
        padding: 0.25lh 0.8ch;
        cursor: default;
        user-select: none;
        display: inline-block;
    }
    :host(*[aria-disabled="true"]) {
        color: GrayText;
        border-color: GrayText;
    }
`);

export class ButtonControl extends HtmlControl {
    constructor() {
        super();

        const shadow = this.attachShadow({ mode: 'open' });
        this.adoptStyleSheet(styleSheet);

        shadow.innerHTML = '<slot></slot>'
    }

    override onEnabledChanged() {
        super.onEnabledChanged();

        const disabled = this.enabled === false;
        if (disabled) {
            this.setAttribute('aria-disabled', 'true');
        }
        else {
            this.removeAttribute('aria-disabled');
        }
    }
}