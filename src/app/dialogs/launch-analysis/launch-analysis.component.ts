import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import {
  AnalysisService, BETWEENNESS_CENTRALITY, CLOSENESS_CENTRALITY,
  DEGREE_CENTRALITY,
  KEYPATHWAYMINER, MAX_TASKS,
  MULTISTEINER, NETWORK_PROXIMITY,
  TRUSTRANK
} from '../../services/analysis/analysis.service';
import { Algorithm, AlgorithmType, QuickAlgorithmType } from 'src/app/interfaces';
import { DrugstoneConfigService } from 'src/app/services/drugstone-config/drugstone-config.service';
import {NetworkHandlerService} from "../../services/network-handler/network-handler.service";

@Component({
  selector: 'app-launch-analysis',
  templateUrl: './launch-analysis.component.html',
  styleUrls: ['./launch-analysis.component.scss']
})
export class LaunchAnalysisComponent implements OnInit, OnChanges {

  @Input()
  public show = false;
  @Input()
  public target: 'drug' | 'drug-target';
  @Output()
  public showChange = new EventEmitter<boolean>();
  @Output()
  public taskEvent = new EventEmitter<object>();

  public algorithm: AlgorithmType | QuickAlgorithmType;

  public algorithms: Array<Algorithm> = [];

  // Trustrank Parameters
  public trustrankIncludeIndirectDrugs = false;
  public trustrankIncludeNonApprovedDrugs = false;
  public trustrankIncludeViralNonSeeds = true;
  public trustrankDampingFactor = 0.85;
  public trustrankMaxDeg = 0;
  public trustrankHubPenalty = 0.0;
  public trustrankResultSize = 20;

  // Closeness Parameters
  public closenessIncludeIndirectDrugs = false;
  public closenessIncludeNonApprovedDrugs = false;
  public closenessIncludeViralNonSeeds = true;
  public closenessMaxDeg = 0;
  public closenessHubPenalty = 0.0;
  public closenessResultSize = 20;

  // Degree Parameters
  public degreeIncludeNonApprovedDrugs = false;
  public degreeIncludeViralNonSeeds = true;
  public degreeMaxDeg = 0;
  public degreeResultSize = 20;

  // Network proximity
  public proximityIncludeNonApprovedDrugs = false;
  public proximityMaxDeg = 0;
  public proximityHubPenalty = 0.0;
  public proximityResultSize = 20;

  // Betweenness Parameters
  public betweennessIncludeViralNonSeeds = true;
  public betweennessMaxDeg = 0;
  public betweennessHubPenalty = 0.0;
  public betweennessResultSize = 20;

  // Keypathwayminer Parameters
  public keypathwayminerK = 5;

  // Multisteiner Parameters
  public multisteinerNumTrees = 5;
  public multisteinerTolerance = 10;
  public multisteinerIncludeViralNonSeeds = true;
  public multisteinerMaxDeg = 0;
  public multisteinerHubPenalty = 0.0;

  public maxTasks = MAX_TASKS;

  constructor(public analysis: AnalysisService, public drugstoneConfig: DrugstoneConfigService, public networkHandler: NetworkHandlerService) {
  }

  ngOnInit(): void {
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.target === 'drug-target') {
      this.algorithms = [MULTISTEINER, KEYPATHWAYMINER, TRUSTRANK, CLOSENESS_CENTRALITY, DEGREE_CENTRALITY, BETWEENNESS_CENTRALITY];
    } else if (this.target === 'drug') {
      this.algorithms = [TRUSTRANK, CLOSENESS_CENTRALITY, DEGREE_CENTRALITY, NETWORK_PROXIMITY];
    } else {
      // return because this.target === undefined
      return
    }
    this.algorithms = this.algorithms.filter(algorithm => this.drugstoneConfig.config.algorithms[this.target].includes(algorithm.slug));
    // sanity check to fallback algorithm, trustrank works on all targets
    if (!this.algorithms.length) {
      this.algorithms = [TRUSTRANK];
    } else {
      this.algorithm = this.algorithms[0].slug;
    }
  }

  public close() {
    this.show = false;
    this.showChange.emit(this.show);
  }

  public async startTask() {
    // all nodes in selection have drugstoneId, hence exist in the backend
    const seeds = this.analysis.getSelection().map((item) => item.id);
    const seedsFiltered = seeds.filter(el => el != null);
    const parameters: any = {
      seeds: seedsFiltered,
      config: this.drugstoneConfig.config,
      input_network: this.networkHandler.activeNetwork.inputNetwork
    };
    parameters.ppi_dataset = this.drugstoneConfig.config.interactionProteinProtein;
    parameters.pdi_dataset = this.drugstoneConfig.config.interactionDrugProtein;
    parameters.licenced = this.drugstoneConfig.config.licencedDatasets;


    parameters.target = this.target === 'drug' ? 'drug' : 'drug-target';
    // pass network data to reconstruct network in analysis result to connect non-proteins to results
    // drop interactions in nodes beforehand to no cause cyclic error, information is contained in edges
    // @ts-ignore
    this.networkHandler.activeNetwork.inputNetwork.nodes.forEach(node => {
      delete node.interactions
    });

    if (this.algorithm === 'trustrank') {
      parameters.damping_factor = this.trustrankDampingFactor;
      parameters.include_indirect_drugs = this.trustrankIncludeIndirectDrugs;
      parameters.include_non_approved_drugs = this.trustrankIncludeNonApprovedDrugs;
      if (this.trustrankMaxDeg && this.trustrankMaxDeg > 0) {
        parameters.max_deg = this.trustrankMaxDeg;
      }
      parameters.hub_penalty = this.trustrankHubPenalty;
      parameters.result_size = this.trustrankResultSize;
    } else if (this.algorithm === 'closeness') {
      parameters.include_indirect_drugs = this.closenessIncludeIndirectDrugs;
      parameters.include_non_approved_drugs = this.closenessIncludeNonApprovedDrugs;
      if (this.closenessMaxDeg && this.closenessMaxDeg > 0) {
        parameters.max_deg = this.closenessMaxDeg;
      }
      parameters.hub_penalty = this.closenessHubPenalty;
      parameters.result_size = this.closenessResultSize;
    } else if (this.algorithm === 'degree') {
      parameters.include_non_approved_drugs = this.degreeIncludeNonApprovedDrugs;
      if (this.degreeMaxDeg && this.degreeMaxDeg > 0) {
        parameters.max_deg = this.degreeMaxDeg;
      }
      parameters.result_size = this.degreeResultSize;
    } else if (this.algorithm === 'proximity') {
      parameters.include_non_approved_drugs = this.proximityIncludeNonApprovedDrugs;
      if (this.proximityMaxDeg && this.proximityMaxDeg > 0) {
        parameters.max_deg = this.proximityMaxDeg;
      }
      parameters.hub_penalty = this.proximityHubPenalty;
      parameters.result_size = this.proximityResultSize;
    } else if (this.algorithm === 'betweenness') {
      if (this.betweennessMaxDeg && this.betweennessMaxDeg > 0) {
        parameters.max_deg = this.betweennessMaxDeg;
      }
      parameters.hub_penalty = this.betweennessHubPenalty;
      parameters.result_size = this.betweennessResultSize;
    } else if (this.algorithm === 'keypathwayminer') {
      parameters.k = this.keypathwayminerK;
    } else if (this.algorithm === 'multisteiner') {
      parameters.num_trees = this.multisteinerNumTrees;
      parameters.tolerance = this.multisteinerTolerance;
      if (this.multisteinerMaxDeg && this.multisteinerMaxDeg > 0) {
        parameters.max_deg = this.multisteinerMaxDeg;
      }
      parameters.hub_penalty = this.multisteinerHubPenalty;
    }
    const token = await this.analysis.startAnalysis(this.algorithm, this.target, parameters);
    const object = { taskId: token, algorithm: this.algorithm, target: this.target, params: parameters };
    this.taskEvent.emit(object);
  }

}
