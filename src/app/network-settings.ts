import { getGradientColor } from './utils';
import {
  Node,
} from './interfaces';
import { IConfig, defaultConfig } from './config';
import * as merge from 'lodash/fp/merge';

export class NetworkSettings {

  // colors
  private static Grey = '#A0A0A0';
  private static White = '#FFFFFF';
  private static Black = '#000000';

  // Node color
  private static hostColor = '#123456';
  private static approvedDrugColor = '#48C774';
  private static unapprovedDrugColor = '#F8981D';
  private static nonSeedHostColor = '#3070B3';

  // Edge color
  private static edgeHostDrugColor = '#686868';
  private static edgeHostDrugHighlightColor = '#686868';
  private static edgeGeneGeneColor = '#686868';
  private static edgeGeneGeneHighlightColor = '#686868';

  private static hostFontColor = NetworkSettings.White;
  private static drugFontColor = NetworkSettings.White;

  // Network Layout
  private static analysisLayout = {
    improvedLayout: true,
  };
  private static analysisEdges = {
    smooth: false,
  };
  private static analysisPhysics = {
    enabled: true,
    stabilization: {
      enabled: true,
    },
    repulsion: {
      centralGravity: 0,
    },
    solver: 'repulsion',
  };
  private static analysisBigPhysics = {
    enabled: false,
  };

  private static mainLayout = {
    improvedLayout: false,
  };
  private static mainEdges = {
    smooth: false,
    length: 250
  };
  private static mainPhysics = {
    enabled: true,
    stabilization: true
  };

  static getOptions(network: 'main' | 'analysis' | 'analysis-big', config) {
    const physicsOn = config.physicsOn;
    const groups = config.nodeGroups;
    if (network === 'main') {
      return {
        layout: this.mainLayout,
        edges: this.mainEdges,
        physics: physicsOn || this.mainPhysics,
        groups,
      };
    } else if (network === 'analysis') {
      return {
        layout: this.analysisLayout,
        edges: this.analysisEdges,
        physics: physicsOn || this.analysisPhysics,
        groups,
      };
    } else if (network === 'analysis-big') {
      return {
        layout: this.analysisLayout,
        edges: this.analysisEdges,
        physics: physicsOn || this.analysisBigPhysics,
        groups,
      };
    }
  }

  static getNodeStyle(
    node: Node,
    config: IConfig,
    isSeed: boolean,
    isSelected: boolean,
    gradient: number = 1,
    renderer = null): Node {
    // delete possible old styles
    Object.keys(config.nodeGroups.default).forEach(e => delete node[e]);

    // note that seed and selected node style are applied after the node style is fetched.
    // this allows to overwrite only attributes of interest, therefore in e.g. seedNode group
    // certain attributes like shape can remain undefined
    // use lodash merge to not lose deep attributes, e.g. "font.size"
    // @ts-ignore
    if (node._group) {
      // @ts-ignore
      node.group = node._group;
    } else {
      // @ts-ignore
      node._group = node.group;
    }

    // @ts-ignore
    if (node._shadow) { // @ts-ignore
      node.shadow = node._shadow;
    } else {
      if (config.nodeGroups[node.group].shadow) {
        node.shadow = { enabled: config.nodeGroups[node.group].shadow };
        node.shadow.color = 'rgba(0,0,0,0.5)';
      } else {
        node.shadow = { color: 'rgba(0,0,0,0.5)' };
      }
    }
    if (isSeed) {
      // apply seed node style to node
      // @ts-ignore
      node._group = node.group;
      node.group = 'seedNode';
    }
    // selection on purpose after seed style, so seed style will be combined with selection style
    if (isSelected) {
      // @ts-ignore
      // node._group = node.group;
      // apply selected node style to node by merging with node style with the selected node style
      node = { ...node, ...config.nodeGroups[node.group] }
      node = merge(node, config.nodeGroups.selectedNode);

      if (config.nodeGroups[node.group].shadow) {
        node.shadow = { enabled: config.nodeGroups[node.group].shadow };
        node.shadow.color = '#000000';
      } else {
        node.shadow = { color: '#000000' };
      }
    } else {
      // remove hard configured attributes from node
      Object.keys(config.nodeGroups.selectedNode).forEach(e => delete node[e]);
      Object.keys(config.nodeGroups[node.group]).forEach(e => delete node[e]);
    }

    // show image if image url is given. If seed nodes are highlighted, ignore image property
    if (node.image && !isSeed) {
      node.shape = 'image';
    }

    // custom ctx renderer for e.g. pie chart
    if (renderer !== null) {
      // @ts-ignore
      node.shape = 'custom';
      node.color = { opacity: gradient };
      node.opacity = gradient;
      if (isSeed) {
        // apply seed node style to node
        // @ts-ignore
        node.color = config.nodeGroups[node.group].color;
      } else {
        delete node.color;
      }
      // @ts-ignore
      node._shadow = node.shadow;
      if (config.nodeGroups[node.group].shadow) {
        node.shadow = { enabled: config.nodeGroups[node.group].shadow };
        node.shadow.color = 'rgba(0,0,0,0.5)';
      } else {
        node.shadow = { color: 'rgba(0,0,0,0.5)' };
      }
      node.ctxRenderer = renderer;
    } else {
      node.opacity = undefined;
      delete node.ctxRenderer;
    }
    return node;
  }
}

