import { toTracked, hasListeners } from "../lib/dependency-tracking.js";
import { BindableControl, setOrRemoveAttribute } from "../lib/bindable-control.js";
import { createNewElementName, postEvent, ensureEvent, throwIfHasEvents } from './unit-test-interfaces.js'

class BasicControl extends BindableControl {
    static override bindableProperties = [...BindableControl.bindableProperties, 'testProperty'];

    #testProperty?: any;

    get testProperty() {
        return this.getProperty('testProperty', this.#testProperty);
    }

    set testProperty(val: any) {
        if (this.#testProperty === val) return;

        const oldVal = this.#testProperty;
        this.#testProperty = val;
        this.notifyPropertySetExplicitly('testProperty', oldVal, val);
    }

    get testPropertyBinding() {
        return this.getAttribute('testProperty');
    }

    set testPropertyBinding(val: string | null) {
        if (val === this.testPropertyBinding) return;

        setOrRemoveAttribute(this, 'test-property', val);
    }

    override onPropertyChanged(property: string): void {
        postEvent(this, 'onPropertyChanged: ' + property);
        super.onPropertyChanged(property);
    }
}

export function testBasicControl(playground: HTMLDivElement) {
    const name = createNewElementName();
    customElements.define(name, BasicControl);

    const ctl = document.createElement(name) as BasicControl;
    playground.appendChild(ctl);
    ensureEvent(ctl, 'onPropertyChanged: testProperty');
    ensureEvent(ctl, 'onPropertyChanged: model');

    throwIfHasEvents();

    if (ctl.testProperty !== undefined) throw new Error('Expected testProperty === undefined.');
    ctl.testPropertyBinding = '1 + 2';
    ensureEvent(ctl, 'onPropertyChanged: testProperty');

    throwIfHasEvents();

    if (ctl.testProperty !== 3) throw new Error('Expected testProperty === 3.');
    ctl.testPropertyBinding = '3 + 4';
    ensureEvent(ctl, 'onPropertyChanged: testProperty');

    throwIfHasEvents();
    
    if (ctl.testProperty !== 7) throw new Error('Expected testProperty === 7.');
    playground.innerHTML = '';

    // we used to notify on disconnected, but the more I think the less it's needed so keeping mum for now
    throwIfHasEvents();

    if (ctl.testProperty !== undefined) throw new Error('Expected undefined.');
    return undefined;
}

class ParentControl extends BasicControl {
};

class ChildControl extends BasicControl {
};

class Model {
    a = 1;

    b = 2;

    get c() {
        return this.a + this.b;
    }

    set [hasListeners] (val: boolean) {
        postEvent(this, 'HasListeners: ' + val);
    }
}

export function testModel(playground: HTMLDivElement) {
    const parentName = createNewElementName();
    customElements.define(parentName, ParentControl);
    const childName = createNewElementName();
    customElements.define(childName, ChildControl);

    const parent = document.createElement(parentName) as ParentControl;
    const child = document.createElement(childName) as ChildControl;

    parent.appendChild(child);

    const model = toTracked(new Model());
    parent.model = model;

    throwIfHasEvents();

    playground.appendChild(parent);
    ensureEvent(parent, 'onPropertyChanged: testProperty');
    ensureEvent(parent, 'onPropertyChanged: model');
    ensureEvent(child, 'onPropertyChanged: testProperty');
    ensureEvent(child, 'onPropertyChanged: model');

    throwIfHasEvents();

    child.testPropertyBinding = "this.c";
    ensureEvent(child, 'onPropertyChanged: testProperty');
    if (child.testProperty !== 3) throw new Error("Expected child.testProperty === 3.");
    model.a = 3;
    ensureEvent(model, 'HasListeners: true');
    ensureEvent(child, 'onPropertyChanged: testProperty');
    if (child.testProperty !== 5) throw new Error("Expected child.testProperty === 5.");
    
    throwIfHasEvents();
    
    playground.innerHTML = '';
    ensureEvent(model, 'HasListeners: false');

    // we used to notify on disconnected, but the more I think the less it's needed so keeping mum for now
    throwIfHasEvents();
    // ensureEvent(child, 'onPropertyChanged: model');
    // ensureEvent(child, 'onPropertyChanged: testProperty');
    // ensureEvent(parent, 'onPropertyChanged: model');
    // ensureEvent(parent, 'onPropertyChanged: testProperty');

    playground.appendChild(parent);
    ensureEvent(parent, 'onPropertyChanged: testProperty');
    ensureEvent(parent, 'onPropertyChanged: model');
    ensureEvent(child, 'onPropertyChanged: testProperty');
    ensureEvent(child, 'onPropertyChanged: model');
    playground.innerHTML = '';
    throwIfHasEvents();
}
