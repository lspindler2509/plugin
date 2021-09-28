import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';
import {
  getDrugNodeId,
  getWrapperFromNode,
  legendContext,
  Node,
  NodeAttributeMap,
  NodeInteraction,
  Tissue,
  Wrapper
} from '../../interfaces';
import {mapCustomEdge, mapCustomNode, mapNetexEdge, ProteinNetwork} from '../../main-network';
import {AnalysisService} from '../../services/analysis/analysis.service';
import {OmnipathControllerService} from '../../services/omnipath-controller/omnipath-controller.service';
import domtoimage from 'dom-to-image';
import {NetworkSettings} from '../../network-settings';
import {defaultConfig, EdgeGroup, IConfig, InteractionDatabase, NodeGroup} from '../../config';
import {NetexControllerService} from 'src/app/services/netex-controller/netex-controller.service';
import {downLoadFile, removeDuplicateObjectsFromList} from '../../utils';
import * as merge from 'lodash/fp/merge';
import {AnalysisPanelComponent} from 'src/app/components/analysis-panel/analysis-panel.component';

declare var vis: any;

@Component({
  selector: 'app-explorer-page',
  templateUrl: './explorer-page.component.html',
  styleUrls: ['./explorer-page.component.scss'],
})

export class ExplorerPageComponent implements OnInit, AfterViewInit {

  private networkJSON = '{"nodes": [], "edges": []}';
  private networkPositions = undefined;

  // set default config on init
  public myConfig: IConfig = JSON.parse(JSON.stringify(defaultConfig));

  @Input()
  public onload: undefined | string;

  @Input()
  public id: undefined | string;

  @Input()
  public set config(config: string | undefined | object) {
    if (config == null) {
      return;
    }
    if (this.id == null)
      setTimeout(() => {
        this.config = config;
      }, 200);
    console.log(config)
    // add settings to config
    const configObj = typeof config === 'object' ? config : JSON.parse(config);
    this.myConfig = merge(this.myConfig, configObj);

    // update Drugst.One according to the settings
    // check if config updates affect network
    let updateNetworkFlag = false;
    for (const key of Object.keys(configObj)) {
      if (key === 'nodeGroups') {
        this.setConfigNodeGroup(key, configObj[key]);
        updateNetworkFlag = true;
      } else if (key === 'edgeGroups') {
        this.setConfigEdgeGroup(key, configObj[key]);
        updateNetworkFlag = true;
      } else if (key === 'interactions') {
        this.getInteractions(configObj[key]);
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
    }
    // trigger updates on config e.g. in legend
    this.myConfig = {...this.myConfig};
    if (updateNetworkFlag && typeof this.networkJSON !== 'undefined') {
      // update network if network config has changed and networkJSON exists
      if (this.networkInternal !== undefined) {
        // a network exists, save node positions
        this.networkPositions = this.networkInternal.getPositions();
      }
      this.createNetwork();
    }
  }

  @Input()
  public set network(network: string | undefined | object) {
    console.log(network)
    if (network == null) {
      return;
    }
    this.networkJSON = typeof network === 'object' ? JSON.stringify(network) : network;
    this.createNetwork();
  }

  @Output()
  public taskEvent = new EventEmitter<object>();

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

  public proteins: Node[];
  public edges: NodeInteraction[];

  private networkInternal: any;
  // this will store the vis Dataset
  public nodeData: { nodes: any, edges: any } = {nodes: null, edges: null};

  private dumpPositions = false;
  public physicsEnabled = false;
  public adjacentDrugs = false;

  public adjacentDrugList: Node[] = [];
  public adjacentDrugEdgesList: Node[] = [];

  public adjacentDisordersProtein = false;
  public adjacentDisordersDrug = false;

  public adjacentProteinDisorderList: Node[] = [];
  public adjacentProteinDisorderEdgesList: Node[] = [];

  public adjacentDrugDisorderList: Node[] = [];
  public adjacentDrugDisorderEdgesList: Node[] = [];

  public queryItems: Wrapper[] = [];
  public showAnalysisDialog = false;
  public showThresholdDialog = false;
  public analysisDialogTarget: 'drug' | 'drug-target';

  public showCustomProteinsDialog = false;

  public selectedAnalysisToken: string | null = null;

  @Input() inputNetwork = {};

  @Input() set taskId(token: string | null) {
    if (token == null || token.length === 0)
      this.selectedAnalysisToken = null
    this.selectedAnalysisToken = token;
  }

  public currentDataset = [];

  public currentViewProteins: Node[];
  public currentViewSelectedTissue: Tissue | null = null;
  public currentViewNodes: Node[];
  public currentViewEdges: NodeInteraction[];

  public expressionExpanded = false;
  public selectedTissue: Tissue | null = null;

  public legendContext: legendContext = 'explorer';

  // keys are node netexIds
  public expressionMap: NodeAttributeMap = undefined;

  @ViewChild('network', {static: false}) networkEl: ElementRef;
  @ViewChild('networkWithLegend', {static: false}) networkWithLegendEl: ElementRef;

  @ViewChild(AnalysisPanelComponent, {static: false})
  private analysisPanel: AnalysisPanelComponent;

  constructor(
    public omnipath: OmnipathControllerService,
    public analysis: AnalysisService,
    public netex: NetexControllerService) {
    this.showDetails = false;
    this.analysis.subscribeList(async (items, selected) => {

      // return if analysis panel is open or no nodes are loaded
      if (this.selectedAnalysisToken || !this.nodeData.nodes) {
        return;
      }
      if (selected !== null) {
        if (items == null || items.length === 0) {
          return;
        }
        const updatedNodes = [];
        for (const wrapper of items) {
          // const node: Node = this.nodeData.nodes.get(wrapper.id);
          const node = wrapper.data as Node;
          if (!node) {
            continue;
          }
          const pos = this.networkInternal.getPositions([wrapper.id]);
          node.x = pos[wrapper.id].x;
          node.y = pos[wrapper.id].y;
          const nodeStyled = NetworkSettings.getNodeStyle(
            node,
            this.myConfig,
            false,
            selected,
            1.0
          )
          nodeStyled.x = pos[wrapper.id].x;
          nodeStyled.y = pos[wrapper.id].y;
          updatedNodes.push(nodeStyled);
        }
        this.nodeData.nodes.update(updatedNodes);
      } else {
        const updatedNodes = [];
        this.nodeData.nodes.forEach((node) => {
          // const nodeSelected = this.analysis.idInSelection(node.id);
          // if (node.group == 'default') {
          //   Object.assign(node, this.myConfig.nodeGroups.default);
          // } else {
          //   Object.assign(node, this.myConfig.nodeGroups[node.group]);
          // };
          Object.assign(node, this.myConfig.nodeGroups[node.group]);

        });
        this.nodeData.nodes.update(updatedNodes);
      }
    });
  }

  @HostListener('window:resize', ['$event'])
  onResize(event) {
    this.setWindowWidth(document.getElementById('appWindow').getBoundingClientRect().width);
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

  async getInteractions(key: InteractionDatabase) {
    let edges = [];
    if (key == 'omnipath') {
      const names = this.nodeData.nodes.map((node) => node.label);
      const nameToNetworkId = {};
      this.nodeData.nodes.map((node) => nameToNetworkId[node.label] = node.id);
      edges = await this.omnipath.getInteractions(names, this.myConfig.identifier, nameToNetworkId);
    }
    this.nodeData.edges.update(edges);
  }

  private async getNetwork() {

    const network = JSON.parse(this.networkJSON);
    if (this.myConfig.identifier === 'ensg') {
      // @ts-ignore
      network.nodes.forEach(node => {
        node.id = this.removeEnsemblVersion(node.id);
      });
      if (network.edges != null)
        // @ts-ignore
        network.edges.forEach(edge => {
          edge.from = this.removeEnsemblVersion(edge.from);
          edge.to = this.removeEnsemblVersion(edge.to);
        });
    }

    // map data to nodes in backend
    if (network.nodes != null && network.nodes.length) {
      network.nodes = await this.netex.mapNodes(network.nodes, this.myConfig.identifier);
    }

    if (this.myConfig.identifier === 'ensg') {
      // remove possible duplicate IDs
      network.nodes = removeDuplicateObjectsFromList(network.nodes, 'netexId');
    }

    // at this point, we have nodes synched with the backend
    // use netexIds where posssible, but use original id as node name if no label given
    const nodeIdMap = {};
    network.nodes.forEach((node) => {
      // set node label to original id before node id will be set to netex id
      node.label = node.label ? node.label : node.id;

      nodeIdMap[node.id] = node.netexId ? node.netexId : node.id;
      node.id = nodeIdMap[node.id];
    });

    // adjust edge labels accordingly and filter
    const edges = new Array();
    if (network.edges != null)
      network.edges.forEach(edge => {
        edge.from = nodeIdMap[edge.from];
        edge.to = nodeIdMap[edge.to];
        // check if edges have endpoints
        if (edge.from !== undefined && edge.to !== undefined) {
          edges.push(edge);
        }
      });
    // remove edges without endpoints
    network.edges = edges;
    this.inputNetwork = network;
    this.proteins = network.nodes;
    this.edges = network.edges;
  }

  private setWindowWidth(width: number) {
    this.windowWidth = width;
    this.smallStyle = this.windowWidth < 1250;
  }


  private zoomToNode(id: string) {
    // get network object, depending on whether analysis is open or not
    const network = this.selectedAnalysisToken ? this.analysisPanel.network : this.networkInternal;

    this.nodeData.nodes.getIds();
    const coords = network.getPositions(id)[id];
    if (!coords) {
      return;
    }
    let zoomScale = null;
    if (id.startsWith('eff')) {
      zoomScale = 1.0;
    } else {
      zoomScale = 3.0;
    }
    network.moveTo({
      position: {x: coords.x, y: coords.y},
      scale: zoomScale,
      animation: true,
    });
  }

  public async openSummary(item: Wrapper, zoom: boolean) {
    this.selectedWrapper = item;
    if (zoom) {
      this.zoomToNode(item.id);
    }
    this.showDetails = true;
  }

  public async closeSummary() {
    this.selectedWrapper = null;
    this.showDetails = false;
  }

  removeEnsemblVersion(versionId: string): string {
    return versionId.startsWith('ENSG') ? versionId.split('.')[0] : versionId;
  }

  public async createNetwork() {
    this.analysis.resetSelection();
    this.selectedWrapper = null;
    // getNetwork synchronizes the input network with the database
    await this.getNetwork();
    this.proteinData = new ProteinNetwork(this.proteins, this.edges);

    if (this.networkPositions) {
      this.proteinData.updateNodePositions(this.networkPositions)
    }
    // TODO do we still need this?
    // this.proteinData.linkNodes();

    const {nodes, edges} = this.proteinData.mapDataToNetworkInput(this.myConfig);

    if (this.myConfig.autofillEdges && nodes.length) {
      const netexEdges = await this.netex.fetchEdges(nodes, this.myConfig.interactionProteinProtein);
      edges.push(...netexEdges.map(netexEdge => mapNetexEdge(netexEdge, this.myConfig)))
    }

    this.nodeData.nodes = new vis.DataSet(nodes);
    this.nodeData.edges = new vis.DataSet(edges);
    const container = this.networkEl.nativeElement;

    const options = NetworkSettings.getOptions('main');

    this.networkInternal = new vis.Network(container, this.nodeData, options);

    this.networkInternal.on('doubleClick', (properties) => {
      const nodeIds: Array<string> = properties.nodes;
      if (nodeIds != null && nodeIds.length > 0) {
        const nodeId = nodeIds[0];
        const node = this.nodeData.nodes.get(nodeId);
        if (node.netexId === undefined || !node.netexId.startsWith('p')) {
          // skip if node is not a protein mapped to backend
          return;
        }
        const wrapper = getWrapperFromNode(node);
        if (this.analysis.inSelection(node)) {
          this.analysis.removeItems([wrapper]);
        } else {
          this.analysis.addItems([wrapper]);
        }
      }
    });
    this.networkInternal.on('click', (properties) => {
      const nodeIds: Array<string> = properties.nodes;
      if (nodeIds != null && nodeIds.length > 0) {
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
      this.zoomToNode(this.selectedWrapper.id);
    }

    this.currentViewNodes = this.nodeData.nodes;
    this.currentViewEdges = this.nodeData.edges;

    this.queryItems = [];
    this.updateQueryItems();
    this.currentViewProteins = this.proteins;
    // this.fillQueryItems(this.currentViewNodes);
    if (this.selectedWrapper) {
      this.networkInternal.selectNodes([this.selectedWrapper.id]);
    }
  }

  updateQueryItems() {
    this.queryItems = [];
    this.currentViewNodes.forEach((protein) => {
      this.queryItems.push(getWrapperFromNode(protein));
    });
  }

  // fillQueryItems(hostProteins: Node[]) {
  //   this.queryItems = [];
  //   hostProteins.forEach((protein) => {
  //     this.queryItems.push(getWrapperFromNode(protein));
  //   });
  //
  //
  //   this.currentViewProteins = this.proteins;
  // }

  public queryAction(item: any) {
    if (item) {
      this.openSummary(item, true);
    }
  }

  public updatePhysicsEnabled(bool: boolean) {
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

  public updateAdjacentProteinDisorders(bool: boolean) {
    this.adjacentDisordersProtein = bool;
    if (this.adjacentDisordersProtein) {
      this.netex.adjacentDisorders(this.nodeData.nodes, 'proteins').subscribe(response => {
        for (const interaction of response.edges) {
          const edge = {from: interaction.protein, to: interaction.disorder};
          this.adjacentProteinDisorderEdgesList.push(mapCustomEdge(edge, this.myConfig));
        }
        for (const disorder of response.disorders) {
          disorder.group = 'defaultDisorder';
          disorder.id = disorder.netexId;
          this.adjacentProteinDisorderList.push(mapCustomNode(disorder, this.myConfig))
        }
        this.saveAddNodes(this.adjacentProteinDisorderList);
        this.nodeData.edges.add(this.adjacentProteinDisorderEdgesList);
        this.updateQueryItems();
      });
      this.legendContext = this.adjacentDrugs ? 'adjacentDrugsAndDisorders' : 'adjacentDisorders';
    } else {
      this.saveRemoveDisorders(this.adjacentProteinDisorderList);
      this.nodeData.edges.remove(this.adjacentProteinDisorderEdgesList);
      this.adjacentProteinDisorderList = [];
      this.adjacentProteinDisorderEdgesList = [];
      this.legendContext = this.adjacentDisordersDrug ? this.legendContext : this.adjacentDrugs ? 'adjacentDrugs' : 'explorer';
      this.updateQueryItems();
    }
  }

  public updateAdjacentDrugDisorders(bool: boolean) {
    this.adjacentDisordersDrug = bool;
    if (this.adjacentDisordersDrug) {
      this.netex.adjacentDisorders(this.nodeData.nodes, 'drugs').subscribe(response => {
        for (const interaction of response.edges) {
          const edge = {from: interaction.drug, to: interaction.disorder};
          this.adjacentDrugDisorderEdgesList.push(mapCustomEdge(edge, this.myConfig));
        }
        for (const disorder of response.disorders) {
          disorder.group = 'defaultDisorder';
          disorder.id = disorder.netexId;
          this.adjacentDrugDisorderList.push(mapCustomNode(disorder, this.myConfig));
        }
        this.saveAddNodes(this.adjacentDrugDisorderList);
        this.nodeData.edges.add(this.adjacentDrugDisorderEdgesList);
        this.updateQueryItems();
      });
      this.legendContext = this.adjacentDrugs ? 'adjacentDrugsAndDisorders' : 'adjacentDisorders';
    } else {
      this.saveRemoveDisorders(this.adjacentDrugDisorderList);
      this.nodeData.edges.remove(this.adjacentDrugDisorderEdgesList);
      this.adjacentDrugDisorderList = [];
      this.adjacentDrugDisorderEdgesList = [];
      this.legendContext = this.adjacentDisordersProtein ? this.legendContext : this.adjacentDrugs ? 'adjacentDrugs' : 'explorer';
      this.updateQueryItems();
    }
  }

  public saveAddNodes(nodeList: Node[]) {
    const existing = this.nodeData.nodes.get().map(n => n.id);
    const toAdd = nodeList.filter(n => existing.indexOf(n.id) === -1)
    this.nodeData.nodes.add(toAdd);
  }

  public saveRemoveDisorders(nodeList: Node[]) {
    const other = this.adjacentDrugDisorderList === nodeList ? this.adjacentProteinDisorderList : this.adjacentDrugDisorderList
    if (other == null)
      this.nodeData.nodes.remove(nodeList);
    else {
      const otherIds = other.map(d => d.id);
      const rest = nodeList.filter(d => otherIds.indexOf(d.id) === -1)
      this.nodeData.nodes.remove(rest)
    }
  }

  public updateAdjacentDrugs(bool: boolean) {
    this.adjacentDrugs = bool;
    if (this.adjacentDrugs) {
      this.netex.adjacentDrugs(this.myConfig.interactionDrugProtein, this.nodeData.nodes).subscribe(response => {
        for (const interaction of response.pdis) {
          const edge = {from: interaction.protein, to: interaction.drug};
          this.adjacentDrugEdgesList.push(mapCustomEdge(edge, this.myConfig));
        }
        for (const drug of response.drugs) {
          drug.group = 'foundDrug';
          drug.id = getDrugNodeId(drug)
          this.adjacentDrugList.push(mapCustomNode(drug, this.myConfig))
        }
        this.nodeData.nodes.add(this.adjacentDrugList);
        this.nodeData.edges.add(this.adjacentDrugEdgesList);
        this.updateQueryItems();
      })
      this.legendContext = this.adjacentDisordersDrug || this.adjacentDisordersProtein ? 'adjacentDrugsAndDisorders' : 'adjacentDrugs';
    } else {
      this.nodeData.nodes.remove(this.adjacentDrugList);
      this.nodeData.edges.remove(this.adjacentDrugEdgesList);
      this.adjacentDrugList = [];
      this.adjacentDrugEdgesList = [];

      this.legendContext = this.adjacentDisordersDrug || this.adjacentDisordersProtein ? 'adjacentDisorders' : 'explorer';
      this.updateQueryItems();
    }
  }

  /**
   * Function to set the node group attribute in config
   * Validates input NodeGroups and handles setting defaults
   * @param key
   * @param values
   */
  public setConfigNodeGroup(key: string, nodeGroups: { [key: string]: NodeGroup }) {
    // make sure that return-groups (seeds, drugs, found nodes) are set
    const defaultNodeGroups = JSON.parse(JSON.stringify(defaultConfig.nodeGroups));
    // user merge function to do deep merge
    nodeGroups = merge(defaultNodeGroups, nodeGroups);

    // make sure all keys are set
    Object.entries(nodeGroups).forEach(([key, group]) => {
      if (!group.color && key !== 'selectedNode') {
        console.error(`Group ${key} has no attribute 'color'.`);
      }
      if (!group.shape && key !== 'selectedNode') {
        console.error(`Group ${key} has no attribute 'shape'.`);
      }
      if (!group.groupName && key !== 'selectedNode') {
        console.error(`Group ${key} has no attribute 'groupName'.`);
      }
      // set default values in case they are not set by user
      // these values are not mandatory but are neede to override default vis js styles after e.g. deselecting
      // because vis js "remembers" styles even though they are removed
      if (!group.borderWidth) {
        group.borderWidth = 0;
      }
      if (!group.borderWidthSelected) {
        group.borderWidthSelected = 0;
      }
      if (!group.font) {
        group.font = defaultConfig.nodeGroups.default.font;
      }
      // if color is set as string, add detail settings
      if (typeof group.color === 'string') {
        group.color = {
          border: group.color,
          background: group.color,
          highlight: {
            border: group.color,
            background: group.color
          }
        }
      }
      // if image is given, set node shape to image
      if (group.image) {
        group.shape = 'image';
      }
      // implement nodeShadow option, it needs to be set for all nodes or none
      group.shadow = this.myConfig.nodeShadow;
    });

    this.myConfig[key] = nodeGroups;
  }

  /**
   * Function to set the edge group attribute in config
   * Validates input EdgeGroups and handles setting defaults
   * @param key
   * @param values
   */
  public setConfigEdgeGroup(key: string, edgeGroups: { [key: string]: EdgeGroup }) {
    // make sure that default-groups are set
    const defaultNodeGroups = JSON.parse(JSON.stringify(defaultConfig.edgeGroups));
    edgeGroups = merge(defaultNodeGroups, edgeGroups);

    // // do not allow '_' in node Group names since it causes problems with backend
    // edgeGroups = removeUnderscoreFromKeys(edgeGroups)

    // make sure all keys are set
    Object.entries(edgeGroups).forEach(([key, value]) => {
      if (!('dashes' in value)) {
        // use dashes default value if not set
        value['dashes'] = defaultConfig.edgeGroups.default.dashes;
      }

      // implement edgeShadow option, it needs to be set for all nodes or none
      value.shadow = this.myConfig.edgeShadow;
    });
    this.myConfig[key] = edgeGroups;
  }

  public toImage() {
    this.downloadDom(this.networkWithLegendEl.nativeElement).catch(error => {
      console.error('Falling back to network only screenshot. Some components seem to be inaccessable, most likely the legend is a custom image with CORS access problems on the host server side.');
      this.downloadDom(this.networkEl.nativeElement).catch(e => {
        console.error('Some network content seems to be inaccessable for saving as a screenshot. This can happen due to custom images used as nodes. Please ensure correct CORS accessability on the images host server.');
        console.error(e);
      });
    });
  }

  public downloadDom(dom: object) {
    return domtoimage.toPng(dom, {bgcolor: '#ffffff'}).then((generatedImage) => {
      const a = document.createElement('a');
      a.href = generatedImage;
      a.download = `Network.png`;
      a.click();
    });
  }

  analysisWindowChanged($event: [any[], [Node[], Tissue], NodeInteraction[]]) {
    if ($event) {
      this.currentViewNodes = $event[0];
      this.currentViewEdges = $event[2];
      this.currentViewProteins = $event[1][0];
      this.currentViewSelectedTissue = $event[1][1];
    } else {
      this.currentViewNodes = this.nodeData.nodes;
      this.currentViewEdges = this.nodeData.edges;
      this.currentViewProteins = this.proteins;
      this.currentViewSelectedTissue = this.selectedTissue;
    }
    // changes for either way (analysis open and close)
    this.selectedWrapper = null;
    this.updateQueryItems();
    // this.fillQueryItems(this.currentViewNodes);
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
        if (item.netexId === undefined) {
          // nodes that are not mapped to backend remain untouched
          continue;
        }
        const node: Node = this.nodeData.nodes.get(item.id);
        if (!node) {
          continue;
        }
        const pos = this.networkInternal.getPositions([item.id]);
        node.x = pos[item.id].x;
        node.y = pos[item.id].y;
        Object.assign(
          node,
          NetworkSettings.getNodeStyle(
            node,
            this.myConfig,
            false,
            this.analysis.inSelection(getWrapperFromNode(item)),
            1.0
          )
        )
        updatedNodes.push(node);
      }
      this.nodeData.nodes.update(updatedNodes);
      // delete expression values
      this.expressionMap = undefined;
    } else {
      this.selectedTissue = tissue
      const minExp = 0.3;
      // filter out non-proteins, e.g. drugs
      const proteinNodes = [];
      this.nodeData.nodes.forEach(element => {
        if (element.id.startsWith('p') && element.netexId !== undefined) {
          proteinNodes.push(element);
        }
      });
      this.netex.tissueExpressionGenes(this.selectedTissue, proteinNodes).subscribe((response) => {
        this.expressionMap = response;
        const updatedNodes = [];
        // mapping from netex IDs to network IDs, TODO check if this step is necessary
        const networkIdMappping = {}
        this.nodeData.nodes.forEach(element => {
          networkIdMappping[element.netexId] = element.id
        });
        const maxExpr = Math.max(...Object.values(this.expressionMap));
        for (const [netexId, expressionlvl] of Object.entries(this.expressionMap)) {
          const networkId = networkIdMappping[netexId]
          const node = this.nodeData.nodes.get(networkId);
          if (node === null) {
            continue;
          }
          const wrapper = getWrapperFromNode(node)
          const gradient = expressionlvl !== null ? (Math.pow(expressionlvl / maxExpr, 1 / 3) * (1 - minExp) + minExp) : -1;
          const pos = this.networkInternal.getPositions([networkId]);
          node.x = pos[networkId].x;
          node.y = pos[networkId].y;
          Object.assign(node,
            NetworkSettings.getNodeStyle(
              node,
              this.myConfig,
              node.isSeed,
              this.analysis.inSelection(wrapper),
              gradient));
          node.gradient = gradient;
          updatedNodes.push(node);
        }
        this.nodeData.nodes.update(updatedNodes);
      })
    }

    this.currentViewSelectedTissue = this.selectedTissue;
  }


  emitTaskEvent(eventObject: object) {
    this.taskEvent.emit(eventObject);
  }

  hasDrugsLoaded(): boolean {
    if (this.nodeData == null || this.nodeData.nodes == null)
      return false;
    return this.nodeData.nodes.get().filter((node: Node) => node.drugId && node.netexId.startsWith('dr')).length > 0;
  }

  setInputNetwork(network: any) {
    if (network == null)
      this.inputNetwork = {nodes: this.proteins, edges: this.edges}
    else
      this.inputNetwork = network;
  }
}
