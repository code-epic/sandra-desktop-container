import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { invoke } from "@tauri-apps/api/core";

@Component({
    selector: 'app-setup-wizard',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './setup-wizard.component.html',
    styleUrls: ['./setup-wizard.component.css']
})
export class SetupWizardComponent implements OnInit {
    @Input() stats: any = null;
    @Input() networkInfo: string[] = [];
    @Output() onComplete = new EventEmitter<any>();

    step = 1;

    formData = {
        name: '',
        description: '',
        area: '',
        // Connection Data
        connName: 'Sandra Server Principal',
        ip_address: '',
        port: 22,
        wss_host: '',
        wss_port: 0
    };

    verifyStatus: "idle" | "checking" | "success" | "error" = "idle";
    isHostAvailable: boolean = false;
    clientId: string = '---';

    async ngOnInit() {
        try {
            this.clientId = await invoke("get_or_create_client_id");
        } catch (e) {
            console.error("Error loading client ID in wizard", e);
        }
    }

    next() {
        if (this.step === 1) {
            if (!this.formData.name || !this.formData.area) {
                // Podríamos mostrar un mensaje o simplemente no avanzar
                return;
            }
        }

        if (this.step < 3) {
            this.step++;
        } else {
            this.finish();
        }
    }

    back() {
        if (this.step > 1) {
            this.step--;
        }
    }

    // --- Host Verification (Copied from ConnectionsComponent) ---
    private debounceTimer: any;
    onAddressChange() {
        if (this.formData.ip_address) {
            this.formData.ip_address = this.formData.ip_address.toLowerCase();
        }
        this.verifyStatus = "idle";
        this.isHostAvailable = false;

        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        if (this.formData.ip_address.length < 3) return;

        this.debounceTimer = setTimeout(() => {
            this.verifyHost();
        }, 800);
    }

    async verifyHost() {
        this.verifyStatus = "checking";
        try {
            const isUp = await invoke<boolean>("verify_connection_status", {
                ip: this.formData.ip_address,
                port: Number(this.formData.port),
            });

            if (isUp) {
                this.verifyStatus = "success";
                this.isHostAvailable = true;
            } else {
                this.verifyStatus = "error";
                this.isHostAvailable = false;
            }
        } catch (err) {
            this.verifyStatus = "error";
            this.isHostAvailable = false;
        }
    }

    finish() {
        if (!this.formData.name || !this.formData.area) {
            alert('Por favor complete el nombre y área del equipo.');
            this.step = 1;
            return;
        }

        if (!this.formData.ip_address) {
            alert('Debe configurar la dirección del servidor.');
            this.step = 3;
            return;
        }

        this.onComplete.emit(this.formData);
    }
}
