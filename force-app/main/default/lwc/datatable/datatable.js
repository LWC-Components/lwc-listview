/* eslint-disable no-console */
import { LightningElement, track, api, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { refreshApex } from '@salesforce/apex';
import wireTableCache from '@salesforce/apex/DataTableService.wireTableCache';
import getTableCache from '@salesforce/apex/DataTableService.getTableCache';
import * as tableUtils from 'c/tableServiceUtils';

// import getTableRequest from 'c/tableService';

// import * as filters from 'force/filterLogicLibrary';

// const _defaultQueryString = 'SELECT Id, Name, UserName, Email FROM User';
// const DELAY = 2000;

export default class Datatable extends LightningElement {
  /***
   * See README.md
   ***/
  // _wiredResults;
  wiredResults;
  _sObject;
  _filter;
  _search;
  _offset = 0;
  _maxRecords;
  _initialRecords;
  _recordsPerBatch;
  _recordCount;
  _tableRequest = '';
  _columnsToHide = {};
  objectInfo;
  @track _sortedDirection='asc';
  @track _sortedBy;
  @track _enableInfiniteLoading;
  @track _selectedRows = [];
  @track _isLoading = true;
  @track data;
  @track _columns;
  @track _fields = [];/*[ // default value - sample. either way we need to document the sample
    // id fields are ignored
    { fieldName: 'Name', sortable: true, sorted: true, searchable: true, visible: true, sortDirection: 'asc' },
    { fieldName: 'Account.Name', searchable: true, sortable: true}
  ];*/

  @api maxRecords=2000;
  @api recordsPerBatch=50;

  get columns(){
    const toReturn = [];
    for (let i = 0; i < this._columns.length; i++) {
        let col = this._columns[i];
        if (this._columnsToHide.hasOwnProperty(col.fieldName)) continue;
        else toReturn.push(col);
    }
    return toReturn;
    // return this._columns;
  }

  set columns(value) {
    this._columns = value;
  }

  SETUP = true;

  get sortedByFormatted() {
    let name = this._sortedBy
    if (name.endsWith('Name')) { // special case for salesforce relationship fields (this will not work for custom relationships)
      name = name.replace('.Name', '_Id');
      name = name.replace('Name', 'Id')
    }
    return name;
  }


  @api
  get sortedBy() {
    return this._sortedBy;
  }
  set sortedBy(value) {
    this._sortedBy = value;
    this.tableRequest = 'reset';
  }

  @api
  get sortedDirection() {
    return this._sortedDirection;
  }
  set sortedDirection(value) {
    this._sortedDirection = value;
    this.tableRequest = 'reset';
  }

  @api
  get initialRecords() {
    return this._initialRecords || this.recordsPerBatch;
  }
  set initialRecords(value) {
    this._initialRecords = value;
  }

  @api enableInfiniteLoading;

  @api hideCheckboxColumn = false;
  @api
  get recordCount() {
    return this._recordCount;
  }
  @api
  get search() {
    return this._search;
  }
  set search(value) {
    this._tableRequest = this.tableRequest;
    this._search = value;
    this.tableRequest = 'reset';
  }

  @api// sObject;
  get sObject() {
    return this._sObject;
  }
  set sObject(value) {
    this._sObject = value;
    this.tableRequest = 'reset';
  }
  @api// filter;
  get filter() {
    return this._filter;
  }
  set filter(value) {
    this._filter = value;
    this.tableRequest = 'reset';
  }

  @api
  get fields() {
    return this._fields;
  }

  // used to check if specific values of fields changed e.g. a field visibility was set/unset
  hasChanges(oldValues, newValues, valuesToCheck) {
      const oldValuesByApiName = {};

      for (let i = 0; i < oldValues.length; i++) {
          oldValuesByApiName[oldValues[i].apiName] = oldValues[i];
      }

      for (let i = 0; i < newValues.length; i++) {
          let newValue = newValues[i];
          let oldValue = oldValuesByApiName[newValue.apiName];

          for (let index = 0; index < valuesToCheck.length; index++) {
            if (oldValue && newValue) {
              if (newValue[valuesToCheck[index]] !== oldValue[valuesToCheck[index]]) return true;
            }
          }
      }
      return false;
  }

  set fields(value) {
    this._columnsToHide = {};
    let hasChanges = false;
    if (!this.SETUP) {
      this._tableRequest = this.tableRequest;
      hasChanges = this.hasChanges(this._fields, value, ['visible']);
    }

    if (value && typeof value == 'string') value = JSON.parse(value);
    else value = JSON.parse(JSON.stringify(value)); // Deep copy the object because LWC does not allow modifying API attributes THIS WILL NOT WORK IF THERE ARE ANY METHODS ON THE OBJECT
    if (Array.isArray(value)) {
      value.forEach(field => {
        if (!field.fieldName) this.error('Field must have a valid `fieldName` property');
        if (typeof field.visible === 'undefined') field.visible = true; // default true
        else field.visible = !!field.visible; // convert to boolean
        field.sortable = !!field.sortable; // convert to boolean (default false)
        if (!field.visible) this._columnsToHide[field.apiName] = 1;
      });
    } else {
      this.error('`fields` is required');
    }

    // this._fields = value;
    this.tableRequest = value; // this may not actually be necessary. we might be able to just assign this._fields directly

    if (hasChanges) this.refresh();
  }

  /**
   * Sample: { label: 'Show Details', callback: (row)=>{do stuff}}
   * Valid input is an array of row actions, or a function (row, doneCallback) { return [rowActions]}
   */
  @api rowActions;

  @api
  get isLoading() {
    return this._isLoading;
  }

  @api
  get selectedRows() {
    return this._selectedRows.map(row => { return row.charAt(0) === '/' ? row.slice(1) : row }); // remove prepended forward slash
  }

  @api
  refresh() {
    this._isLoading = true;
    refreshApex(this.wiredResults).then(() => {
      this._isLoading = false;
    }).catch(e => {
      this.error(e.message);
    });
  }

  @api
  clearSelection() {
    this._selectedRows = [];
  }

  @wire(getObjectInfo, { objectApiName: '$sObject' })
  wiredObjectInfo({ error, data }) {
    if (data) {
      this.objectInfo = data;
    } else if (error) {
      this.error(error.statusText + ': ' + error.body.message);
    }
  }

  setUpColumns(columns){
    columns = this.addFieldMetadata(columns);
    if (this.SETUP) {
      this.SETUP = false;
      // for the first time we are showing the datatable, we should have the Full Name / Id
      for (let index = 0; index < columns.length; index++) {
        const col = columns[index];
        if (col.fieldName === 'Id') {
            columns.unshift(columns.splice(index, 1)[0]);
            break;
        }
      }
    }
    return columns;
  }

  @wire(wireTableCache, { tableRequest: '$tableRequest' })
  wiredCache(result) {
    this.wiredResults = result;
    let error, data;
    ({ error, data } = result);
    if (data) {
      this.data = tableUtils.applyLinks(tableUtils.flattenQueryResult(data.tableData));
      this._offset = this.data.length;
      this.columns = this.setUpColumns(data.tableColumns);
      if (this.datatable) this.datatable.selectedRows = this._selectedRows;
      this._enableInfiniteLoading = this.enableInfiniteLoading;
      this._isLoading = false;
      this._recordCount = data.recordCount;
      this.dispatchEvent(new CustomEvent('loaddata', {
        detail: {
          recordCount: this.recordCount,
          sortedDirection: this.sortedDirection,
          sortedBy: this.sortedBy
        }
      }));
    } else if (error) {
      this.error(error.statusText + ': ' + error.body.message);
    }
  }

  loadMoreData() {
    this.datatable.isLoading = true;
    const recordsToLoad = (
      (this.recordsPerBatch + this._offset) <= this.maxRecords ?
        this.recordsPerBatch :
        this.maxRecords - this._offset);
    return getTableCache({
      tableRequest: {
        queryString: this.query + ' LIMIT ' + recordsToLoad + ' OFFSET ' + this._offset
      }
    }).then((data) => {
      data = tableUtils.applyLinks(tableUtils.flattenQueryResult(data.tableData));
      this.data = this.data.concat(data);
      this.datatable.isLoading = false;
      this.datatable.selectedRows = this._selectedRows;
      this._offset += data.length;
      if (this._offset >= this.maxRecords || data.length < recordsToLoad) {
        this._enableInfiniteLoading = false;
      }
    }).catch((err) => {
      throw err;
    });
  }

  get datatable() {
    return this.template.querySelector('lightning-datatable');
  }

  get tableRequest() {
    return JSON.stringify({
      sObject: this.sObject,
      filter: this.where,
      queryString: this.query + ' LIMIT ' + this.initialRecords
    });
  }

  set tableRequest(value) {
    // this._tableRequest = this.tableRequest;
    if (!Array.isArray(value)) this._fields = [...this._fields]; // hack to force wire to reload
    else this._fields = value;
    if (this.SETUP) {
        this._isLoading = true;
    } else {
      this._isLoading = (this.tableRequest !== this._tableRequest);
    }
  }

  @api
  get query() {
    let soql = 'SELECT ' + (this.fields.some(field => field.fieldName === 'Id' && field.visible) ? '' : 'Id,') + // include Id in query if is not defined
      this.fields
        // .filter(field => field.visible) // exclude fields set to not be visible
        // .filter(field => field.fieldName.includes('.') || !this.objectInfo && this.objectInfo.fields[field.fieldName]) // exclude fields that are not existent (does not check related fields)
        .map(field => field.fieldName).join(',') +
      ' FROM ' + this.sObject +
      this.where +
      this.orderBy;
    return soql;
  }

  get where() {
    let filter = this.filter;
    let search;
    if (this.search) {
      let searchTerm = this.search.replace("'", "\\'");
      search = this.fields
        .filter(field => {
          if (Object.prototype.hasOwnProperty.call(field, 'searchable')) {
            return field.searchable;
          }
          if (!this.objectInfo || !this.objectInfo.fields[field.fieldName]) {
            return false;
          }
          let fieldType = this.objectInfo.fields[field.fieldName].dataType;
          return fieldType === 'String' || fieldType === 'Email' || fieldType === 'Phone';
        })
        .map(field => {
          return field.fieldName + ' LIKE \'%' + searchTerm + '%\'';
        }).join(' OR ');
      if (search) {
        search = '(' + search + ')';
      }
    }
    if (filter && search) {
      filter += ' AND ' + search;
    } else if (search) {
      filter = search;
    }
    if (filter) {
      return ' WHERE ' + filter;
    }
    return '';
  }

  get orderBy() {
    if (!this.sortedBy) this.error('Sort field is required');
    let sortedDirection = this.sortedDirection.toLowerCase() === 'desc' ? 'desc nulls last' : 'asc nulls first';
    return ' ORDER BY ' + this.sortedBy + ' ' + sortedDirection;
  }

  error(err) {
    if (typeof err == 'string') err = new Error(err);
    const evt = new ShowToastEvent({
      title: err.name + ' - ' + err.message,
      message: err.stack,
      variant: 'error',
      mode: 'sticky'
    });
    this.dispatchEvent(evt);
    // console.error(err);
    throw (err);
  }

  getRowActions(row, renderActions) {
    const actions = this.rowActions.filterRowActions(row, this.rowActions.availableActions);
    renderActions(actions);
  }

  addFieldMetadata(columns) {
    columns = JSON.parse(JSON.stringify(columns))
      .map(col => {
        let fieldName = col.fieldName;
        if (fieldName.endsWith('Id')) { // special case for salesforce relationship fields (this will not work for custom relationships)
          fieldName = fieldName.replace('_Id', '.Name');
          fieldName = fieldName.replace('Id', 'Name')
        }
        let field = this.fields.find(f => (f.fieldName === fieldName));
        if (field) { // copy values from fields list to columns list
          col.sortable = field.sortable;
        }
        return col;
      });
    if (this.rowActions.availableActions && this.rowActions.availableActions.length || typeof this.rowActions.availableActions === 'function') {
      columns.push({
        type: 'action',
        typeAttributes: {
          rowActions: this.getRowActions.bind(this)
        }
      });
    }
    return columns;
  }

  updateSortField(event) {
    let fieldName = event.detail.fieldName;
    if (fieldName.endsWith('Id')) { // special case for salesforce relationship fields (this will not work for custom relationships)
      fieldName = fieldName.replace('_Id', '.Name');
      fieldName = fieldName.replace('Id', 'Name')
    }
    this.sortedBy = fieldName;
    this.sortedDirection = event.detail.sortDirection;

    this.tableRequest = 'reset';
  }

  handleRowAction(event) {
    const action = event.detail.action;
    if (action && action.callback) {
      const row = JSON.parse(JSON.stringify(event.detail.row)); // deep copy so changes can be made that will not affect anything
      Promise.resolve(action.callback(row))
        .then((result)=> {
          const rows = this.data;
          const rowIndex = rows.findIndex(r=>r.Id === row.Id);
          if (result) {
            rows[rowIndex] = result;
          } else if (result === false) {
            rows.splice(rowIndex,1);
            this._offset--;
          }
          this.data = [...rows];
        });
    }
  }

  handleRowSelection(event) {
    let availableRows = this.data.map(row => row.Id);
    let newRows = event.detail.selectedRows.map(row => row.Id);

    let selectedRows = this._selectedRows
      .filter(row => !availableRows.includes(row)) // keep rows that arent in the current table
      .concat(newRows); // add currently selected rows

    this._selectedRows = selectedRows;

    this.dispatchEvent(new CustomEvent('rowselection', {
      detail: {
        selectedRows: selectedRows
      }
    }));
  }
}