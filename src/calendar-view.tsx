import {
  BasesAllOptions,
  BasesEntry,
  BasesPropertyId,
  BasesView,
  DateValue,
  Menu,
  parsePropertyId,
  QueryController,
} from "obsidian";
import React, { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import { CalendarHandle, CalendarReactView } from "./CalendarReactView";
import { AppContext } from "./context";

export const CalendarViewType = "calendar";

interface CalendarEntry {
  entry: BasesEntry;
  startDate: Date;
  endDate?: Date;
  recurringDoW?: number[];
}

export class CalendarView extends BasesView {
  type = CalendarViewType;
  scrollEl: HTMLElement;
  containerEl: HTMLElement;
  root: Root | null = null;
  calendarHandleRef = React.createRef<CalendarHandle | null>();

  // Internal rendering data
  private entries: CalendarEntry[] = [];
  private startDateProp: BasesPropertyId | null = null;
  private endDateProp: BasesPropertyId | null = null;
  private recurringProp: BasesPropertyId | null = null;
  private weekStartDay: number = 1;
  private dayNameToNumber: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  constructor(controller: QueryController, scrollEl: HTMLElement) {
    super(controller);
    this.scrollEl = scrollEl;
    this.containerEl = scrollEl.createDiv({
      cls: "bases-calendar-container is-loading",
      attr: { tabIndex: 0 },
    });
  }

  onload(): void {
    // React components will handle their own lifecycle
  }

  onunload() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.entries = [];
  }

  onResize(): void {
    // Tell FullCalendar to recalculate dimensions (e.g. after tab switch)
    this.calendarHandleRef.current?.updateSize();
  }

  public focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }

  public onDataUpdated(): void {
    this.containerEl.removeClass("is-loading");
    this.loadConfig();
    this.updateCalendar();
  }

  private loadConfig(): void {
    this.startDateProp = this.config.getAsPropertyId("startDate");
    this.endDateProp = this.config.getAsPropertyId("endDate");
    this.recurringProp = this.config.getAsPropertyId("recurringEvent");
    const weekStartDayValue = this.config.get("weekStartDay") as string;

    this.weekStartDay = weekStartDayValue
      ? (this.dayNameToNumber[weekStartDayValue] ?? 1)
      : 1; // Default to Monday
  }

  private updateCalendar(): void {
    if (!this.data || !this.startDateProp) {
      this.root?.unmount();
      this.root = null;
      this.containerEl.empty();
      this.containerEl.createDiv("bases-calendar-empty").textContent =
        "Configure a start date property to display entries";
      return;
    }

    this.entries = [];
    for (const entry of this.data.data) {
      const startDate = this.extractDate(entry, this.startDateProp);
      let recurringDoW;
      if (startDate) {
        if (this.recurringProp) {
          recurringDoW = this.extractRecurr(entry, this.recurringProp, startDate);
        }
        const endDate = this.endDateProp
          ? (this.extractDate(entry, this.endDateProp) ?? undefined)
          : undefined;
        this.entries.push({
          entry,
          startDate,
          endDate,
          recurringDoW
        });
      }
    }

    this.renderReactCalendar();
  }

  private renderReactCalendar(): void {
    if (!this.root) {
      this.root = createRoot(this.containerEl);
    }

    this.root.render(
      <StrictMode>
        <AppContext.Provider value={this.app}>
          <CalendarReactView
            entries={this.entries}
            weekStartDay={this.weekStartDay}
            properties={this.config.getOrder() || []}
            onEntryClick={(entry, isModEvent) => {
              void this.app.workspace.openLinkText(
                entry.file.path,
                "",
                isModEvent,
              );
            }}
            onEntryContextMenu={(evt, entry) => {
              evt.preventDefault();
              this.showEntryContextMenu(evt.nativeEvent, entry);
            }}
            onEventDrop={(entry, newStart, newEnd) =>
              this.updateEntryDates(entry, newStart, newEnd)
            }
            editable={this.isEditable()}
            calendarHandleRef={this.calendarHandleRef}
          />
        </AppContext.Provider>
      </StrictMode>,
    );
  }

  private isEditable(): boolean {
    if (!this.startDateProp) return false;
    const startDateProperty = parsePropertyId(this.startDateProp);
    if (startDateProperty.type !== "note") return false;

    if (!this.endDateProp) return true;
    const endDateProperty = parsePropertyId(this.endDateProp);
    if (endDateProperty.type !== "note") return false;

    if (!this.recurringProp) return true;
    const recurringProperty = parsePropertyId(this.endDateProp);
    if (recurringProperty.type !== "note") return false;

    return true;
  }

  private extractDate(entry: BasesEntry, propId: BasesPropertyId): Date | null {
    try {
      const value = entry.getValue(propId);
      if (!value) return null;
      if (!(value instanceof DateValue)) return null;
      // Private API
      if ("date" in value && value.date && value.date instanceof Date) {
        return value.date;
      }

      return null;
    } catch (error) {
      console.error(`Error extracting date for ${entry.file.name}:`, error);
      return null;
    }
  }

  private extractRecurr(entry: BasesEntry, propId: BasesPropertyId, startDate: Date): number[] | undefined {
    const value = entry.getValue(propId)
    console.log(value);
    if (!value || ('type' in value && value.type == "Null")) {
      return undefined;
    }
    let recurrDay = [];
    if (value.toString() == "weekly") {
      recurrDay.push(startDate.getDay());
      return recurrDay;
    }
    if(value.toString() == "daily") {
      return [0, 1, 2, 3, 4, 5, 6];
    }
    const stringDays: String[] = value.toString().split(",");
    console.log(stringDays)
    for (let i = 0; i < stringDays.length; i++) {
      recurrDay.push(this.dayNameToNumber[stringDays[i].toString().trim().toLowerCase()]);
    }
    console.log(recurrDay);
    return recurrDay;
  }

  private showEntryContextMenu(evt: MouseEvent, entry: BasesEntry): void {
    const file = entry.file;
    const menu = Menu.forEvent(evt);

    this.app.workspace.handleLinkContextMenu(menu, file.path, "");

    menu.addItem((item) =>
      item
        .setSection("danger")
        .setTitle("Delete file")
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .onClick(() => this.app.fileManager.promptForDeletion(file)),
    );
  }

  private async updateEntryDates(
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
  ): Promise<void> {
    if (!this.startDateProp) return;

    const file = entry.file;
    const startPropName = this.startDateProp;
    const endPropName = this.endDateProp;

    const extractedStartProp = startPropName.startsWith("note.")
      ? startPropName.slice(5)
      : null;

    const extractedEndProp = endPropName?.startsWith("note.")
      ? endPropName.slice(5)
      : null;

    const shouldUpdate =
      extractedStartProp !== null &&
      (!this.endDateProp || extractedEndProp !== null);

    if (!shouldUpdate) {
      return;
    }

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const formatDate = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      };

      frontmatter[extractedStartProp] = formatDate(newStart);
      if (this.endDateProp && newEnd && extractedEndProp) {
        frontmatter[extractedEndProp] = formatDate(newEnd);
      }
    });
  }

  public setEphemeralState(state: unknown): void {
    // State management could be extended for React component
  }

  public getEphemeralState(): unknown {
    return {};
  }

  static getViewOptions(): BasesAllOptions[] {
    return [
      {
        displayName: "Date properties",
        type: "group",
        items: [
          {
            displayName: "Start date",
            type: "property",
            key: "startDate",
            placeholder: "Property",
          },
          {
            displayName: "End date (optional)",
            type: "property",
            key: "endDate",
            placeholder: "Property",
          },
          {
            displayName: "Recurring event (optional)",
            type: "property",
            key: "recurringEvent",
            placeholder: "Property",
          },
        ],
      },
      {
        displayName: "Calendar options",
        type: "group",
        items: [
          {
            displayName: "Week starts on",
            type: "dropdown",
            key: "weekStartDay",
            default: "monday",
            options: {
              sunday: "Sunday",
              monday: "Monday",
              tuesday: "Tuesday",
              wednesday: "Wednesday",
              thursday: "Thursday",
              friday: "Friday",
              saturday: "Saturday",
            },
          },
        ],
      },
    ];
  }
}
