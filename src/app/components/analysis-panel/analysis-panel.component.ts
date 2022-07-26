import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {environment} from '../../../environments/environment';
import {algorithmNames, AnalysisService} from '../../services/analysis/analysis.service';
import {
  Drug,
  EdgeType,
  NodeAttributeMap,
  getDrugNodeId,
  getProteinNodeId,
  getWrapperFromNode,
  LegendContext,
  Node,
  Task,
  Tissue,
  Wrapper,
  NodeInteraction,
} from '../../interfaces';
import domtoimage from 'dom-to-image';
import {NetworkSettings} from '../../network-settings';
import {NetexControllerService} from 'src/app/services/netex-controller/netex-controller.service';
import {defaultConfig, IConfig} from 'src/app/config';
import {mapCustomEdge, mapCustomNode} from 'src/app/main-network';
import {downLoadFile, pieChartContextRenderer, removeDuplicateObjectsFromList} from 'src/app/utils';
import {DrugstoneConfigService} from 'src/app/services/drugstone-config/drugstone-config.service';
import {NetworkHandlerService} from 'src/app/services/network-handler/network-handler.service';


declare var vis: any;

interface Scored {
  score: number;  // Normalized or unnormalized (whichever user selects, will be displayed in the table)
  rawScore: number;  // Unnormalized (kept to restore unnormalized value)
}

interface Seeded {
  isSeed: boolean;
}

interface Baited {
  closestViralProteins: string[];
  closestDistance: number;
}

@Component({
  selector: 'app-analysis-panel',
  templateUrl: './analysis-panel.component.html',
  styleUrls: ['./analysis-panel.component.scss'],
})
export class AnalysisPanelComponent implements OnInit, OnChanges, AfterViewInit {

  @ViewChild('networkWithLegend', {static: false}) networkWithLegendEl: ElementRef;
  @Input() token: string | null = null;

  @Input()
  public set config(config: IConfig | undefined) {
    if (typeof config === 'undefined') {
      return;
    }
    for (const key of Object.keys(config)) {
      this.myConfig[key] = config[key];
    }
  }

  @Output() tokenChange = new EventEmitter<string | null>();
  @Output() showDetailsChange = new EventEmitter<Wrapper>();
  @Output() setInputNetwork = new EventEmitter<any>();
  @Output() visibleItems = new EventEmitter<[any[], [Node[], Tissue], NodeInteraction[]]>();
  public task: Task | null = null;
  public result: any = null;
  public myConfig: IConfig = JSON.parse(JSON.stringify(defaultConfig));

  public network: any;
  public nodeData: { nodes: any, edges: any } = {nodes: null, edges: null};
  private drugNodes: any[] = [];
  private drugEdges: any[] = [];
  public showDrugs = false;
  public tab: 'meta' | 'network' | 'table' = 'table';

  public adjacentDrugs = false;
  public adjacentDrugList: Node[] = [];
  public adjacentDrugEdgesList: Node[] = [];

  public adjacentDisordersProtein = false;
  public adjacentDisordersDrug = false;

  public adjacentProteinDisorderList: Node[] = [];
  public adjacentProteinDisorderEdgesList: Node[] = [];

  public adjacentDrugDisorderList: Node[] = [];
  public adjacentDrugDisorderEdgesList: Node[] = [];

  private proteins: any;
  public effects: any;

  public tableDrugs: Array<Drug & Scored & Baited> = [];
  public tableProteins: Array<Node & Scored & Seeded & Baited> = [];
  public tableSelectedProteins: Array<Node & Scored & Seeded & Baited> = [];
  public tableViralProteins: Array<Scored & Seeded> = [];
  public tableSelectedViralProteins: Array<Scored & Seeded> = [];
  public tableNormalize = false;
  public tableHasScores = false;

  public LegendContext: LegendContext = 'drugTarget';

  public expressionExpanded = false;
  public selectedTissue: Tissue | null = null;

  public algorithmNames = algorithmNames;

  public tableDrugScoreTooltip = '';
  public tableProteinScoreTooltip = '';

  public expressionMap: NodeAttributeMap;

  public legendContext: LegendContext = 'drug';

  constructor(public networkHandler: NetworkHandlerService, public drugstoneConfig: DrugstoneConfigService, private http: HttpClient, public analysis: AnalysisService, public netex: NetexControllerService) {
  }

  async ngOnInit() {
  }

  ngAfterViewInit() {
    this.networkHandler.setActiveNetwork('analysis');
  }

  async ngOnChanges(changes: SimpleChanges) {
    await this.refresh();
  }

  private async refresh() {
    if (this.token) {
      this.task = await this.getTask(this.token);
      this.analysis.switchSelection(this.token);

      if (this.task.info.algorithm === 'degree') {
        this.tableDrugScoreTooltip =
          'Normalized number of direct interactions of the drug with the seeds. ' +
          'The higher the score, the more relevant the drug.';
        this.tableProteinScoreTooltip =
          'Normalized number of direct interactions of the protein with the seeds. ' +
          'The higher the score, the more relevant the protein.';
      } else if (this.task.info.algorithm === 'closeness' || this.task.info.algorithm === 'quick' || this.task.info.algorithm === 'super') {
        this.tableDrugScoreTooltip =
          'Normalized inverse mean distance of the drug to the seeds. ' +
          'The higher the score, the more relevant the drug.';
        this.tableProteinScoreTooltip =
          'Normalized inverse mean distance of the protein to the seeds. ' +
          'The higher the score, the more relevant the protein.';
      } else if (this.task.info.algorithm === 'trustrank') {
        this.tableDrugScoreTooltip =
          'Amount of ‘trust’ on the drug at termination of the algorithm. ' +
          'The higher the score, the more relevant the drug.';
        this.tableProteinScoreTooltip =
          'Amount of ‘trust’ on the protein at termination of the algorithm. ' +
          'The higher the score, the more relevant the protein.';
      } else if (this.task.info.algorithm === 'proximity') {
        this.tableDrugScoreTooltip =
          'Empirical z-score of mean minimum distance between the drug’s targets and the seeds. ' +
          'The lower the score, the more relevant the drug.';
        this.tableProteinScoreTooltip =
          'Empirical z-score of mean minimum distance between the drug’s targets and the seeds. ' +
          'The lower the score, the more relevant the drug.';
      }

      if (this.task && this.task.info.done) {
        this.result = await this.netex.getTaskResult(this.token);
        console.log(this.result)
        const nodeAttributes = this.result.nodeAttributes || {};

        this.networkHandler.activeNetwork.seedMap = nodeAttributes.isSeed || {};

        // Reset
        this.nodeData = {nodes: null, edges: null};
        this.networkHandler.activeNetwork.networkEl.nativeElement.innerHTML = '';
        this.networkHandler.activeNetwork.networkInternal = null;
        this.showDrugs = false;

        // Create
        const {nodes, edges} = this.createNetwork(this.result);
        this.setInputNetwork.emit({nodes: nodes, edges: edges});
        this.nodeData.nodes = new vis.DataSet(nodes);
        this.nodeData.edges = new vis.DataSet(edges);
        const container = this.networkHandler.activeNetwork.networkEl.nativeElement;
        const isBig = nodes.length > 100 || edges.length > 100;
        const options = NetworkSettings.getOptions(isBig ? 'analysis-big' : 'analysis', this.myConfig.physicsOn);
        this.drugstoneConfig.config.physicsOn = !isBig;

        this.networkHandler.activeNetwork.networkInternal = new vis.Network(container, this.nodeData, options);

        this.tableDrugs = nodes.filter(e => e.drugstoneId && e.drugstoneId.drugstoneType === 'drug');
        this.tableDrugs.forEach((r) => {
          r.rawScore = r.score;
        });

        this.tableProteins = nodes.filter(e => e.drugstoneId && e.drugstoneType === 'protein');
        this.tableSelectedProteins = [];
        this.tableProteins.forEach((r) => {
          r.rawScore = r.score;
          r.isSeed = this.networkHandler.activeNetwork.seedMap[r.id];
          const wrapper = getWrapperFromNode(r);
          if (this.analysis.inSelection(wrapper)) {
            this.tableSelectedProteins.push(r);
          }
        });


        this.tableHasScores = ['trustrank', 'closeness', 'degree', 'proximity', 'betweenness', 'quick', 'super']
          .indexOf(this.task.info.algorithm) !== -1;
        if (this.tableHasScores) {
          if (this.task.info.algorithm !== 'proximity') {
            this.toggleNormalization(true);
          } else {
            this.toggleNormalization(false);
          }
        }

        this.networkHandler.activeNetwork.networkInternal.on('deselectNode', (properties) => {
          this.showDetailsChange.emit(null);
        });

        this.networkHandler.activeNetwork.networkInternal.on('doubleClick', (properties) => {
          const nodeIds: Array<string> = properties.nodes;
          if (nodeIds.length > 0) {
            const nodeId = nodeIds[0];
            const node = this.nodeData.nodes.get(nodeId);
            if (node.nodeType === 'drug' || node.drugstoneId === undefined || node.drugstoneType !== 'protein') {
              return;
            }
            const wrapper = getWrapperFromNode(node);
            if (this.analysis.inSelection(wrapper)) {
              this.analysis.removeItems([wrapper]);
              this.analysis.getCount();
            } else {
              this.analysis.addItems([wrapper]);
              this.analysis.getCount();
            }
          }
        });

        this.networkHandler.activeNetwork.networkInternal.on('click', (properties) => {
          const selectedNodes = this.nodeData.nodes.get(properties.nodes);
          if (selectedNodes.length > 0) {
            this.showDetailsChange.emit(getWrapperFromNode(selectedNodes[0]));
          } else {
            this.showDetailsChange.emit(null);
          }
        });

        this.analysis.subscribeList((items, selected) => {
          // return if analysis panel is closed or no nodes are loaded
          if (!this.token) {
            return;
          }

          if (selected !== null) {
            const updatedNodes: Node[] = [];
            for (const item of items) {
              const node = this.nodeData.nodes.get(item.id);
              if (!node) {
                continue;
              }
              const pos = this.networkHandler.activeNetwork.networkInternal.getPositions([item.id]);
              node.x = pos[item.id].x;
              node.y = pos[item.id].y;
              const isSeed = this.networkHandler.activeNetwork.highlightSeeds ? this.networkHandler.activeNetwork.seedMap[node.id] : false;
              const gradient = (this.networkHandler.activeNetwork.gradientMap !== {}) && (this.networkHandler.activeNetwork.gradientMap[item.id]) ? this.networkHandler.activeNetwork.gradientMap[item.id] : 1.0;
              const nodeStyled = NetworkSettings.getNodeStyle(
                node,
                this.myConfig,
                isSeed,
                selected,
                gradient
              )
              updatedNodes.push(nodeStyled);
            }
            this.nodeData.nodes.update(updatedNodes);

            const proteinSelection = this.tableSelectedProteins;
            const viralProteinSelection = this.tableSelectedViralProteins;
            for (const item of items) {
              // TODO: Refactor!
              const found = proteinSelection.findIndex((i) => getProteinNodeId(i) === item.id);
              const tableItem = this.tableProteins.find((i) => getProteinNodeId(i) === item.id);
              if (selected && found === -1 && tableItem) {
                proteinSelection.push(tableItem);
              }
              if (!selected && found !== -1 && tableItem) {
                proteinSelection.splice(found, 1);
              }
            }
            this.tableSelectedProteins = [...proteinSelection];
            this.tableSelectedViralProteins = [...viralProteinSelection];
          } else {
            // else: selected is null
            const updatedNodes = [];
            this.nodeData.nodes.forEach((node) => {
              const isSeed = this.networkHandler.activeNetwork.highlightSeeds ? this.networkHandler.activeNetwork.seedMap[node.id] : false;
              const gradient = (this.networkHandler.activeNetwork.gradientMap !== {}) && (this.networkHandler.activeNetwork.gradientMap[node.id]) ? this.networkHandler.activeNetwork.gradientMap[node.id] : 1.0;
              const nodeStyled = NetworkSettings.getNodeStyle(
                node,
                this.myConfig,
                isSeed,
                selected,
                gradient
              )
              updatedNodes.push(nodeStyled);
            });
            this.nodeData.nodes.update(updatedNodes);

            const proteinSelection = [];
            const viralProteinSelection = [];
            for (const item of items) {
              const tableItem = this.tableProteins.find((i) => getProteinNodeId(i) === item.id);
              if (tableItem) {
                proteinSelection.push(tableItem);
              }
            }
            this.tableSelectedProteins = [...proteinSelection];
            this.tableSelectedViralProteins = [...viralProteinSelection];
          }
        });
      }
    }
    this.emitVisibleItems(true);

    this.networkHandler.activeNetwork.setLegendContext();
  }

  public emitVisibleItems(on: boolean) {
    if (on) {
      this.visibleItems.emit([this.nodeData.nodes, [this.proteins, this.selectedTissue], this.nodeData.edges]);
    } else {
      this.visibleItems.emit(null);
    }
  }

  private async getTask(token: string): Promise<any> {
    return await this.http.get(`${environment.backend}task/?token=${token}`).toPromise();
  }

  close() {
    this.networkHandler.activeNetwork.gradientMap = {};
    this.expressionExpanded = false;
    this.expressionMap = undefined;
    this.networkHandler.activeNetwork.seedMap = {};
    this.networkHandler.activeNetwork.highlightSeeds = false;
    this.showDrugs = false;
    this.analysis.switchSelection('main');
    this.token = null;
    this.tokenChange.emit(this.token);
    this.setInputNetwork.emit(undefined);
    this.emitVisibleItems(false);
  }

  public toggleNormalization(normalize: boolean) {
    this.tableNormalize = normalize;

    const normalizeFn = (table) => {
      let max = 0;
      table.forEach(i => {
        if (i.rawScore > max) {
          max = i.rawScore;
        }
      });
      table.forEach(i => {
        i.score = i.rawScore / max;
      });
    };

    const unnormalizeFn = (table) => {
      table.forEach(i => {
        i.score = i.rawScore;
      });
    };

    if (normalize) {
      normalizeFn(this.tableDrugs);
      normalizeFn(this.tableProteins);
      normalizeFn(this.tableViralProteins);
    } else {
      unnormalizeFn(this.tableDrugs);
      unnormalizeFn(this.tableProteins);
      unnormalizeFn(this.tableViralProteins);
    }
  }


  public downloadLink(view: string): string {
    return `${environment.backend}task_result/?token=${this.token}&view=${view}&fmt=csv`;
  }

  /**
   * Maps analysis result returned from database to valid Vis.js network input
   *
   * @param result
   * @returns
   */
  public createNetwork(result: any): { edges: any[], nodes: any[] } {
    const config = result.parameters.config;
    this.myConfig = config;

    const identifier = this.myConfig.identifier;

    // add drugGroup and foundNodesGroup for added nodes
    // these groups can be overwritten by the user
    const nodes = [];

    const attributes = result.nodeAttributes || {};

    this.proteins = [];
    this.effects = [];
    const network = result.network;

    // const nodeTypes = attributes.nodeTypes || {};
    // const isSeed = attributes.isSeed || {};
    // const scores = attributes.scores || {};
    const details = attributes.details || {};
    const nodeIdMap = {}
    // const reverseNodeIdMap = {}
    // @ts-ignore
    Object.entries(details).filter(e => e[1].drugstoneType === 'protein').forEach(e => {
      // let id =
      // @ts-ignore
      e[1].drugstoneId.forEach(id=>{
         nodeIdMap[id] = e[1][identifier][0]
      })

      // if (!nodeIdMap[id])
      //   nodeIdMap[id] = [e[0]]
      // else
      //   nodeIdMap[id].push(e[0])
    })
    for (const nodeId of Object.keys(details)) {
      const nodeDetails = details[nodeId]
      nodeDetails.id = nodeDetails.id ? nodeDetails.id : (typeof nodeDetails.drugstoneId === 'string' ? nodeDetails.drugstoneId : nodeDetails.drugstoneId[0]);
      if (nodeDetails.drugstoneId && nodeDetails.drugstoneType === 'protein') {
        // node is protein from database, has been mapped on init to backend protein from backend
        // or was found during analysis
        nodeDetails.group = result.targetNodes && result.targetNodes.indexOf(nodeId) !== -1 ? 'foundNode' : (nodeDetails.group ? nodeDetails.group : 'default' );
        nodeDetails.label = nodeDetails.label ? nodeDetails.label : nodeDetails[identifier];
        nodeDetails.id = nodeDetails[identifier][0] ? nodeDetails[identifier][0] : nodeDetails.id;
        this.proteins.push(nodeDetails);
      } else if (nodeDetails.drugstoneId && nodeDetails.drugstoneType === 'drug') {
        // node is drug, was found during analysis
        nodeDetails.type = 'Drug';
        nodeDetails.group = 'foundDrug';
      } else {
        // node is custom input from user, could not be mapped to backend protein
        nodeDetails.group = nodeDetails.group ? nodeDetails.group : 'default';
        nodeDetails.label = nodeDetails.label ? nodeDetails.label : nodeDetails[identifier]
      }
      // further analysis and the button function can be used to highlight seeds
      // option to use scores[node] as gradient, but sccores are very small
      console.log(nodeDetails)
      nodes.push(NetworkSettings.getNodeStyle(nodeDetails as Node, config, false, false, 1))
    }

    const edges = [];

    for (const edge of network.edges) {
      const e = mapCustomEdge(edge, this.myConfig)
      e.from = e.from[0] === 'p' ? nodeIdMap[e.from] : e.from
      e.to = e.to[0] === 'p' ? nodeIdMap[e.to] : e.to
      edges.push(e);
    }
    return {
      nodes,
      edges,
    };
  }

  public tableProteinSelection = (e): void => {
    const oldSelection = [...this.tableSelectedProteins];
    this.tableSelectedProteins = e;
    const addItems = [];
    const removeItems = [];
    for (const i of this.tableSelectedProteins) {
      const wrapper = getWrapperFromNode(i);
      if (oldSelection.indexOf(i) === -1) {
        addItems.push(wrapper);
      }
    }
    for (const i of oldSelection) {
      const wrapper = getWrapperFromNode(i);
      if (this.tableSelectedProteins.indexOf(i) === -1) {
        removeItems.push(wrapper);
      }
    }
    this.analysis.addItems(addItems);
    this.analysis.removeItems(removeItems);
  }
}
