import {
  AfterViewInit,
  Component, Directive,
  ElementRef, HostListener, Input,
  OnInit,
  ViewChild
} from '@angular/core';
import {
  NodeInteraction,
  Node,
  Wrapper,
  getWrapperFromNode,
  Tissue
} from '../../interfaces';
import {ProteinNetwork} from '../../main-network';
import {AnalysisService} from '../../services/analysis/analysis.service';
import {OmnipathControllerService} from '../../services/omnipath-controller/omnipath-controller.service';
import html2canvas from 'html2canvas';
import {NetworkSettings} from '../../network-settings';
import {defaultConfig, EdgeGroup, IConfig, NodeGroup} from '../../config';
import {NetexControllerService} from 'src/app/services/netex-controller/netex-controller.service';
import { removeUnderscoreFromKeys } from 'src/app/utils';
// import * as 'vis' from 'vis-network';
// import {DataSet} from 'vis-data';
// import {vis} from 'src/app/scripts/vis-network.min.js';
declare var vis: any;
// import {Network, Data} from 'vis-network';
// declare var DataSet: any;
// declare var Network: any;

@Component({
  selector: 'app-explorer-page',
  templateUrl: './explorer-page.component.html',
  styleUrls: ['./explorer-page.component.scss'],
})

export class ExplorerPageComponent implements OnInit, AfterViewInit {

  private networkJSON = '{"nodes": [], "edges": []}';

  // set default config on init
  public myConfig: IConfig = JSON.parse(JSON.stringify(defaultConfig));

  @Input()
  public onload: undefined | string;

  @Input()
  public set config(config: string | undefined) {
    if (typeof config === 'undefined') {
      return;
    }
    // check if config updates affect network
    let updateNetworkFlag = false;

    const configObj = JSON.parse(config);
    for (const key of Object.keys(configObj)) {
      if (key === 'nodeGroups' ) {
        this.setConfigNodeGroup(key, configObj[key]);
        updateNetworkFlag = true;
        // dont set the key here, will be set in function
        continue;
      } else if (key === 'edgeGroups') {
        this.setConfigEdgeGroup(key, configObj[key])
        updateNetworkFlag = true;
        // dont set the key here, will be set in function
        continue;
      }
      else if (key === 'interactions') {
        this.getInteractions();
        updateNetworkFlag = true;
        // dont set the key here, will be set in function
        continue;
      } else if (key === 'showLeftSidebar') {
        if (configObj[key]) {
          // shrink main column
          document.getElementById('main-column').classList.remove('leftgone');
        } else {
          // extend main column
          document.getElementById('main-column').classList.add('leftgone');
        }
      } else if (key === 'showRightSidebar') {
        if (configObj[key]) {
          // shrink main column
          document.getElementById('main-column').classList.remove('rightgone');
        } else {
          // extend main column
          document.getElementById('main-column').classList.add('rightgone');
        }
      }
      this.myConfig[key] = configObj[key];
    }
    if (updateNetworkFlag && typeof this.networkJSON !== 'undefined') {
      // update network if network config has changed and networkJSON exists
      this.createNetwork();
    }
  }

  @Input()
  public set network(network: string | undefined) {
    if (typeof network === 'undefined') {
      return;
    }
    this.networkJSON = network;
    this.createNetwork();
  }

  public get network() {
    return this.networkJSON;
  }

  public windowWidth = 0;
  public smallStyle = false;

  public showDetails = false;
  public selectedWrapper: Wrapper | null = null;

  public collapseAnalysisQuick = true;
  public collapseAnalysis = true;
  public collapseDetails = true;
  public collapseTask = true;
  public collapseSelection = true;
  public collapseBaitFilter = true;
  public collapseQuery = true;
  public collapseData = true;
  public collapseOverview = true;

  public proteinData: ProteinNetwork;

  public proteins: any;
  public edges: any;

  private networkInternal: any;
  // this will store the vis Dataset
  public nodeData: { nodes: any, edges: any } = {nodes: null, edges: null};

  private dumpPositions = false;
  public physicsEnabled = false;

  public queryItems: Wrapper[] = [];
  public showAnalysisDialog = false;
  public showThresholdDialog = false;
  public analysisDialogTarget: 'drug' | 'drug-target';

  public showCustomProteinsDialog = false;

  public selectedAnalysisToken: string | null = null;

  public currentDataset = [];

  public currentViewProteins: Node[];
  public currentViewSelectedTissue: Tissue | null = null;
  public currentViewNodes: Node[];

  public expressionExpanded = false;
  public selectedTissue: Tissue | null = null;

  @Input()
  public textColor = 'red';

  @ViewChild('network', {static: false}) networkEl: ElementRef;

  constructor(
    public omnipath: OmnipathControllerService,
    public analysis: AnalysisService,
    public netex: NetexControllerService) {


    this.showDetails = false;

    this.analysis.subscribeList((items, selected) => {
      if (!this.nodeData.nodes) {
        return;
      }
      if (selected !== null) {
        if (items.length === 0) {
          return;
        }
        const updatedNodes = [];
        for (const item of items) {
          const node = this.nodeData.nodes.get(item.id);
          if (!node) {
            continue;
          }
          const pos = this.networkInternal.getPositions([item.id]);
          node.x = pos[item.id].x;
          node.y = pos[item.id].y;
          Object.assign(node, this.myConfig.nodeGroups[node.group]);
          updatedNodes.push(node);
        }
        this.nodeData.nodes.update(updatedNodes);
      } else {
        const updatedNodes = [];
        this.nodeData.nodes.forEach((node) => {
          const nodeSelected = this.analysis.idInSelection(node.id);
          Object.assign(node, this.myConfig.nodeGroups[node.group]);
        });
        this.nodeData.nodes.update(updatedNodes);
      }
    });
  }

  @HostListener('window:resize', ['$event'])
  onResize(event) {
    this.setWindowWidth(event.target.innerWidth);
  }

  ngOnInit() {
    this.setWindowWidth(document.getElementById('appWindow').getBoundingClientRect().width);
  }

  async ngAfterViewInit() {
    // TODO find out if this had a function? we were loading the network twice
    // this.createNetwork();

    if (this.onload) {
      // tslint:disable-next-line:no-eval
      eval(this.onload);
    }
  }

  async getInteractions() {
    const names = this.nodeData.nodes.map((node) => node.label);
    const nameToNetworkId = {};
    this.nodeData.nodes.map((node) => nameToNetworkId[node.label] = node.id);
    const edges = await this.omnipath.getInteractions(names, this.myConfig.identifier, nameToNetworkId);

    this.nodeData.edges.update(edges);
  }

  private async getNetwork() {

    const network = JSON.parse(this.networkJSON);

    // map data to nodes in backend
    if (network.nodes.length) {
      network.nodes = await this.netex.mapNodes(network.nodes, this.myConfig.identifier);
    }
    this.proteins = network.nodes;
    this.edges = network.edges;
  }

  private setWindowWidth(width: number) {
    this.windowWidth = width;
    this.smallStyle = this.windowWidth < 1250;
  }

  private zoomToNode(id: string) {
    this.nodeData.nodes.getIds();
    const coords = this.networkInternal.getPositions(id)[id];
    if (!coords) {
      return;
    }
    let zoomScale = null;
    if (id.startsWith('eff')) {
      zoomScale = 1.0;
    } else {
      zoomScale = 3.0;
    }
    this.networkInternal.moveTo({
      position: {x: coords.x, y: coords.y},
      scale: zoomScale,
      animation: true,
    });
  }

  public async openSummary(item: Wrapper, zoom: boolean) {
    this.selectedWrapper = item;
    if (zoom) {
      this.zoomToNode(item.nodeId);
    }
    this.showDetails = true;
  }

  public async closeSummary() {
    this.selectedWrapper = null;
    this.showDetails = false;
  }

  // public async updateNetwork() {

  // }

  public async createNetwork() {
    this.analysis.resetSelection();
    this.selectedWrapper = null;
    await this.getNetwork();
    this.proteinData = new ProteinNetwork(this.proteins, this.edges);
    this.proteinData.linkNodes();

    const {nodes, edges} = this.proteinData.mapDataToNetworkInput(this.myConfig);

    this.nodeData.nodes = new vis.DataSet(nodes);
    this.nodeData.edges = new vis.DataSet(edges);
    const container = this.networkEl.nativeElement;
    const options = NetworkSettings.getOptions('main');
    this.networkInternal = new vis.Network(container, this.nodeData, options);
    this.networkInternal.on('doubleClick', (properties) => {
      const nodeIds: Array<string> = properties.nodes;
      if (nodeIds.length > 0) {
        const nodeId = nodeIds[0];
        const node = this.nodeData.nodes.get(nodeId);
        const wrapper = getWrapperFromNode(node);
        if (wrapper.data.netexId === undefined || !wrapper.data.netexId.startsWith('p')) {
          // skip if node is not a protein mapped to backend
          return
        }
        if (this.analysis.inSelection(node)) {
          this.analysis.removeItems([wrapper]);
        } else {
          this.analysis.addItems([wrapper]);
        }
      }
    });

    this.networkInternal.on('click', (properties) => {
      const nodeIds: Array<string> = properties.nodes;
      if (nodeIds.length > 0) {
        const nodeId = nodeIds[0];
        const node = this.nodeData.nodes.get(nodeId);
        const wrapper = getWrapperFromNode(node);
        this.openSummary(wrapper, false);
      } else {
        this.closeSummary();
      }
    });
    this.networkInternal.on('deselectNode', (properties) => {
      this.closeSummary();
    });

    if (this.selectedWrapper) {
      this.zoomToNode(this.selectedWrapper.nodeId);
    }

    this.queryItems = [];
    this.fillQueryItems(this.proteins);
    if (this.selectedWrapper) {
      this.networkInternal.selectNodes([this.selectedWrapper.nodeId]);
    }
  }

  fillQueryItems(hostProteins: Node[]) {
    this.queryItems = [];
    hostProteins.forEach((protein) => {
      this.queryItems.push(getWrapperFromNode(protein));
    });

    this.currentViewNodes = this.nodeData.nodes;
    this.currentViewProteins = this.proteins;
  }

  public queryAction(item: any) {
    if (item) {
      this.openSummary(item, true);
    }
  }

  public updatePhysicsEnabled(bool) {
    this.physicsEnabled = bool;
    this.networkInternal.setOptions({
      physics: {
        enabled: this.physicsEnabled,
        stabilization: {
          enabled: false,
        },
      }
    });
  }

    /**
   * Function to set the node group attribute in config 
   * Validates input NodeGroups and handles setting defaults
   * @param key 
   * @param values 
   */
  public setConfigNodeGroup(key: string, nodeGroups: { [key: string]: NodeGroup}) {
    if (nodeGroups === undefined || !Object.keys(nodeGroups).length) {
      // if node groups are not set or empty, use default node group(s)
      this.myConfig[key] = defaultConfig.nodeGroups;
      // stop if nodeGroups do not contain any information
      return
    }

    // // do not allow '_' in node Group names since it causes problems with backend
    // nodeGroups = removeUnderscoreFromKeys(nodeGroups)

    // make sure all keys are set
    Object.entries(nodeGroups).forEach(([key, group]) => {
      if (!('detailShowLabel' in group)) {
        // use detailShowLabel default value if not set
        group['detailShowLabel'] = defaultConfig.nodeGroups.default.detailShowLabel;
      }
    })

    // make sure that return-groups (seeds, drugs, found nodes) are set
    const defaultNodeGroups = JSON.parse(JSON.stringify(defaultConfig.nodeGroups));
    // if user has set nodeGroups, do not use group "default"
    delete defaultNodeGroups.default;
    // if user has not set the return-groups, take the defaults
    nodeGroups = {...defaultNodeGroups, ...nodeGroups}
    
    // override default node groups
    this.myConfig[key] = nodeGroups;
  }

  /**
   * Function to set the edge group attribute in config
   * Validates input EdgeGroups and handles setting defaults
   * @param key 
   * @param values 
   */
  public setConfigEdgeGroup(key: string, edgeGroups: { [key: string]: EdgeGroup}) {
    if (edgeGroups === undefined || !Object.keys(edgeGroups).length) {
      // if edge groups are not set or empty, use default edge group(s)
      this.myConfig[key] = defaultConfig.edgeGroups;
      // stop if edgeGroups do not contain any information
      return
    }
    
    // // do not allow '_' in node Group names since it causes problems with backend
    // edgeGroups = removeUnderscoreFromKeys(edgeGroups)

    // make sure all keys are set
    Object.entries(edgeGroups).forEach(([key, value]) => {
      if (!('dashes' in value)) {
        // use dashes default value if not set
        value['dashes'] = defaultConfig.edgeGroups.default.dashes;
      }
    })
    // override default node groups
    this.myConfig[key] = edgeGroups;
  }

  public toCanvas() {
    html2canvas(this.networkEl.nativeElement).then((canvas) => {
      const generatedImage = canvas.toDataURL('image/png').replace('image/png', 'image/octet-stream');
      const a = document.createElement('a');
      a.href = generatedImage;
      a.download = `Network.png`;
      a.click();
    });
  }

  analysisWindowChanged($event: [any[], [Node[], Tissue]]) {
    if ($event) {
      this.currentViewNodes = $event[0];
      this.currentViewProteins = $event[1][0];
      this.currentViewSelectedTissue = $event[1][1];
    } else {
      this.currentViewNodes = this.nodeData.nodes;
      this.currentViewProteins = this.proteins;
      this.currentViewSelectedTissue = this.selectedTissue;
    }
  }

  gProfilerLink(): string {
    // nodes in selection have netexId
    const queryString = this.analysis.getSelection()
      .filter(wrapper => wrapper.data.netexId.startsWith('p'))
      .map(wrapper => wrapper.data.uniprotAc)
      .join('%0A');
    return 'http://biit.cs.ut.ee/gprofiler/gost?' +
      'organism=hsapiens&' +
      `query=${queryString}&` +
      'ordered=false&' +
      'all_results=false&' +
      'no_iea=false&' +
      'combined=false&' +
      'measure_underrepresentation=false&' +
      'domain_scope=annotated&' +
      'significance_threshold_method=g_SCS&' +
      'user_threshold=0.05&' +
      'numeric_namespace=ENTREZGENE_ACC&' +
      'sources=GO:MF,GO:CC,GO:BP,KEGG,TF,REAC,MIRNA,HPA,CORUM,HP,WP&' +
      'background=';
  }

  public selectTissue(tissue: Tissue | null) {
    this.expressionExpanded = false;
    if (!tissue) {
      this.selectedTissue = null;
      const updatedNodes = [];
      for (const item of this.proteins) {
        const node = this.nodeData.nodes.get(item.nodeId);
        if (!node) {
          continue;
        }
        const pos = this.networkInternal.getPositions([item.nodeId]);
        node.x = pos[item.nodeId].x;
        node.y = pos[item.nodeId].y;
        // Object.assign(node,
        //   NetworkSettings.getNodeStyle(
        //     node.wrapper.type,
        //     node.isSeed,
        //     this.analysis.inSelection(item),
        //     undefined,
        //     undefined,
        //     1.0));
        node.wrapper = item;
        node.gradient = 1.0;
        // protein.expressionLevel = undefined;
        (node.wrapper.data as Node).expressionLevel = undefined;
        updatedNodes.push(node);
      }
      this.nodeData.nodes.update(updatedNodes);
    } else {
      this.selectedTissue = tissue;

      const minExp = 0.3;

      // const params = new HttpParams().set('tissue', `${tissue.id}`).set('data', JSON.stringify(this.currentDataset));
      // this.http.get<any>(
      //   `${environment.backend}tissue_expression/`, {params})
      //   .subscribe((levels) => {
      //     const updatedNodes = [];
      //     const maxExpr = Math.max(...levels.map(lvl => lvl.level));
      //     for (const lvl of levels) {
      //       const item = getWrapperFromNode(lvl.protein);
      //       const node = this.nodeData.nodes.get(item.nodeId);
      //       if (!node) {
      //         continue;
      //       }
      //       const gradient = lvl.level !== null ? (Math.pow(lvl.level / maxExpr, 1 / 3) * (1 - minExp) + minExp) : -1;
      //       const pos = this.network.getPositions([item.nodeId]);
      //       node.x = pos[item.nodeId].x;
      //       node.y = pos[item.nodeId].y;
      //       Object.assign(node,
      //         NetworkSettings.getNodeStyle(
      //           node.wrapper.type,
      //           node.isSeed,
      //           this.analysis.inSelection(item),
      //           undefined,
      //           undefined,
      //           gradient));
      //       node.wrapper = item;
      //       node.gradient = gradient;
      //       this.proteins.find(prot => getProteinNodeId(prot) === item.nodeId).expressionLevel = lvl.level;
      //       (node.wrapper.data as Protein).expressionLevel = lvl.level;
      //       updatedNodes.push(node);
      //     }
      //     this.nodeData.nodes.update(updatedNodes);
      //   });

    }

    this.currentViewSelectedTissue = this.selectedTissue;
  }

}
