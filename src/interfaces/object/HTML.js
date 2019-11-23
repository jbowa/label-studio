import React, { Component } from "react";
import { observer, inject } from "mobx-react";
import { types, getType, getRoot, getParentOfType } from "mobx-state-tree";

import { cloneNode } from "../../core/Helpers";
import Registry from "../../core/Registry";
import { guidGenerator, restoreNewsnapshot } from "../../core/Helpers";

import * as xpath from "xpath-range";

import RegionsMixin from "../mixins/Regions";

import { runTemplate } from "../../core/Template";

import InfoModal from "../../components/Infomodal/Infomodal";
import { LabelsModel } from "../control/Labels";

import { highlightRange, splitBoundaries } from "../../utils/html";

import { HTMLRegionModel } from "./HTMLRegion";
import Utils from "../../utils";

/**
 * HTML tag shows an HTML markup that can be labeled
 * @example
 * <HTML name="text-1" value="$text"></HTML>
 * @name HTML
 * @param {string} name of the element
 * @param {string} value of the element
 */
const TagAttrs = types.model("HTMLModel", {
  name: types.maybeNull(types.string),
  // text: types.maybeNull(types.optional(types.string, "Please set \"value\" attribute of Text")),
  value: types.maybeNull(types.string),

  /**
   * If we allow selecting parts of words of we select whole word only
   */
  adjustselection: types.optional(types.boolean, true),
  selectionenabled: types.optional(types.boolean, true),
});

const Model = types
  .model("HTMLModel", {
    id: types.optional(types.identifier, guidGenerator),
    type: "html",
    regions: types.array(HTMLRegionModel),
    _value: types.optional(types.string, ""),
  })
  .views(self => ({
    get hasStates() {
      const states = self.states();
      return states && states.length > 0;
    },

    get completion() {
      return getRoot(self).completionStore.selected;
    },

    states() {
      return self.completion.toNames.get(self.name);
    },

    activeStates() {
      const states = self.states();
      return states
        ? states.filter(s => s.isSelected && (getType(s).name === "LabelsModel" || getType(s).name === "RatingModel"))
        : null;
    },
  }))
  .actions(self => ({
    findRegion(start, startOffset, end, endOffset) {
      const immutableRange = self.regions.find(r => {
        return r.start === start && r.end === end && r.startOffset === startOffset && r.endOffset === endOffset;
      });
      return immutableRange;
    },

    updateValue(store) {
      self._value = runTemplate(self.value, store.task.dataObj);
    },

    _addRange(p) {
      const r = HTMLRegionModel.create({
        startOffset: p.startOffset,
        endOffset: p.endOffset,
        start: p.start,
        end: p.end,
        text: "",
        states: p.states,
      });

      r._range = p._range;

      self.regions.push(r);
      self.completion.addRegion(r);

      return r;
    },

    addRange(range) {
      const states = self.activeStates();
      if (states.length == 0) return;

      const clonedStates = states
        ? states.map(s => {
            return cloneNode(s);
          })
        : null;

      const r = self._addRange({ ...range, states: clonedStates });

      states &&
        states.forEach(s => {
          return s.unselectAll();
        });

      return r;
    },

    /**
     * Return JSON
     */
    toStateJSON() {
      const objectsToReturn = self.regions.map(r => r.toStateJSON());
      return objectsToReturn;
    },

    /**
     *
     * @param {*} obj
     * @param {*} fromModel
     */
    fromStateJSON(obj, fromModel) {
      const { start, startOffset, end, endOffset } = obj.value;

      if (fromModel.type === "textarea" || fromModel.type === "choices") {
        self.completion.names.get(obj.from_name).fromStateJSON(obj);
        return;
      }

      const states = restoreNewsnapshot(fromModel);
      const tree = {
        pid: obj.id,
        startOffset: startOffset,
        endOffset: endOffset,
        start: start,
        end: end,
        normalization: obj.normalization,
        states: [states],
      };

      states.fromStateJSON(obj);

      self._addRange(tree);
    },
  }));

const HTMLModel = types.compose("HTMLModel", RegionsMixin, TagAttrs, Model);

class HtxHTMLView extends Component {
  constructor(props) {
    super(props);
    this.myRef = React.createRef();
  }

  captureDocumentSelection() {
    var i,
      len,
      ranges = [],
      rangesToIgnore = [],
      selection = window.getSelection();

    var self = this;

    if (selection.isCollapsed) {
      return [];
    }

    for (i = 0; i < selection.rangeCount; i++) {
      var r = selection.getRangeAt(i);

      try {
        var normedRange = xpath.fromRange(r, self.myRef.current);

        splitBoundaries(r);
        normedRange._range = r;

        // If the new range falls fully outside our this.element, we should
        // add it back to the document but not return it from this method.
        if (normedRange === null) {
          rangesToIgnore.push(r);
        } else {
          ranges.push(normedRange);
        }
      } catch (err) {}
    }

    // BrowserRange#normalize() modifies the DOM structure and deselects the
    // underlying text as a result. So here we remove the selected ranges and
    // reapply the new ones.
    selection.removeAllRanges();

    return ranges;
  }

  componentDidMount() {
    const root = this.myRef.current;

    this.props.item.regions.forEach(function(r) {
      const range = xpath.toRange(r.start, r.startOffset, r.end, r.endOffset, root);

      splitBoundaries(range);

      r._range = range;

      let labelColor = r.states.map(s => {
        return s.getSelectedColor();
      });

      if (labelColor.length !== 0) {
        labelColor = Utils.Colors.convertToRGBA(labelColor[0], 0.3);
      }

      const spans = highlightRange(r, "htx-highlight", { backgroundColor: labelColor });
      r._spans = spans;
    });

    Array.from(this.myRef.current.getElementsByTagName("a")).forEach(a => {
      a.addEventListener("click", function(ev) {
        ev.preventDefault();
        return false;
      });
    });
  }

  onMouseUp(ev) {
    var selectedRanges = this.captureDocumentSelection();

    const states = this.props.item.activeStates();
    if (states.length === 0) return;

    if (selectedRanges.length === 0) {
      return;
    }

    const htxRange = this.props.item.addRange(selectedRanges[0]);

    let labelColor = htxRange.states.map(s => {
      return s.getSelectedColor();
    });

    if (labelColor.length !== 0) {
      labelColor = Utils.Colors.convertToRGBA(labelColor[0], 0.3);
    }

    const spans = highlightRange(htxRange, "htx-highlight", { backgroundColor: labelColor });
    htxRange._spans = spans;
  }

  render() {
    const self = this;
    const { item, store } = this.props;

    return (
      <div
        ref={this.myRef}
        onMouseUp={this.onMouseUp.bind(this)}
        dangerouslySetInnerHTML={{ __html: runTemplate(item.value, store.task.dataObj) }}
      />
    );
  }
}

const HtxHTML = inject("store")(observer(HtxHTMLView));

Registry.addTag("html", HTMLModel, HtxHTML);

export { HTMLModel, HtxHTML };