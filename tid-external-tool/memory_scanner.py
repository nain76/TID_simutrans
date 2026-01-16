#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Simutrans TiD - Memory Scanner
Reads Simutrans process memory to extract train and station data
"""

import sys
import json
import struct
from dataclasses import dataclass
from typing import List, Optional

# Platform-specific imports
if sys.platform == 'win32':
    try:
        import pymem
        import pymem.process
    except ImportError:
        print("Error: pymem not installed. Run: pip install pymem")
        sys.exit(1)
else:  # Linux
    import os


@dataclass
class Koord3D:
    """3D coordinate in Simutrans"""
    x: int
    y: int
    z: int


@dataclass
class ConvoyData:
    """Convoy (train) data extracted from memory"""
    id: int
    name: str
    position: Koord3D
    speed: int
    schedule_name: str
    capacity: int
    load: int
    state: str
    next_stop_name: str

    @property
    def occupancy_percent(self):
        """Calculate occupancy percentage"""
        if self.capacity == 0:
            return 0
        return int((self.load * 100) / self.capacity)


@dataclass
class HaltData:
    """Station/halt data extracted from memory"""
    name: str
    position: Koord3D


class MemoryReader:
    """Cross-platform memory reader for Simutrans process"""

    def __init__(self, process_name="simutrans.exe"):
        self.process_name = process_name
        self.base_address = 0

        if sys.platform == 'win32':
            self._init_windows()
        else:
            self._init_linux()

    def _init_windows(self):
        """Initialize Windows memory reading via pymem"""
        try:
            self.pm = pymem.Pymem(self.process_name)
            self.base_address = self.pm.process_base.lpBaseOfDll
            self.process_id = self.pm.process_id
            print(f"✓ Attached to process '{self.process_name}' (PID: {self.process_id})")
        except pymem.exception.ProcessNotFound:
            raise RuntimeError(f"Process '{self.process_name}' not found. Make sure Simutrans is running.")

    def _init_linux(self):
        """Initialize Linux memory reading via /proc"""
        import psutil

        # Find Simutrans process
        process_name_clean = self.process_name.replace('.exe', '')
        found_process = None

        for proc in psutil.process_iter(['pid', 'name']):
            if process_name_clean.lower() in proc.info['name'].lower():
                found_process = proc
                break

        if not found_process:
            raise RuntimeError(f"Process '{process_name_clean}' not found. Make sure Simutrans is running.")

        self.process_id = found_process.info['pid']
        self.mem_file = f"/proc/{self.process_id}/mem"
        self.maps_file = f"/proc/{self.process_id}/maps"

        # Find base address
        self.base_address = self._find_base_address_linux()
        print(f"✓ Attached to process (PID: {self.process_id})")

    def _find_base_address_linux(self):
        """Find base address of Simutrans executable in Linux"""
        try:
            with open(self.maps_file, 'r') as f:
                for line in f:
                    if 'simutrans' in line.lower() and 'r-x' in line:
                        return int(line.split('-')[0], 16)
        except Exception as e:
            print(f"Warning: Could not find base address: {e}")
        return 0

    def read_int(self, address):
        """Read 32-bit integer from memory"""
        try:
            if sys.platform == 'win32':
                return self.pm.read_int(address)
            else:
                return self._read_linux(address, 4, 'i')
        except Exception as e:
            # print(f"Warning: Failed to read int at 0x{address:X}: {e}")
            return 0

    def read_short(self, address):
        """Read 16-bit short from memory"""
        try:
            if sys.platform == 'win32':
                return self.pm.read_short(address)
            else:
                return self._read_linux(address, 2, 'h')
        except:
            return 0

    def read_byte(self, address):
        """Read 8-bit byte from memory"""
        try:
            if sys.platform == 'win32':
                return self.pm.read_uchar(address)
            else:
                return self._read_linux(address, 1, 'B')
        except:
            return 0

    def read_pointer(self, address):
        """Read pointer (8 bytes on 64-bit, 4 bytes on 32-bit)"""
        try:
            if sys.platform == 'win32':
                # Assume 64-bit
                return self.pm.read_longlong(address)
            else:
                return self._read_linux(address, 8, 'Q')
        except:
            return 0

    def read_string(self, address, max_length=256):
        """Read null-terminated string from memory"""
        try:
            if sys.platform == 'win32':
                return self.pm.read_string(address, max_length)
            else:
                return self._read_string_linux(address, max_length)
        except:
            return ""

    def _read_linux(self, address, size, fmt):
        """Read data from Linux /proc/pid/mem"""
        try:
            with open(self.mem_file, 'rb') as f:
                f.seek(address)
                data = f.read(size)
                return struct.unpack(fmt, data)[0]
        except:
            return 0

    def _read_string_linux(self, address, max_length):
        """Read null-terminated string from Linux memory"""
        try:
            with open(self.mem_file, 'rb') as f:
                f.seek(address)
                data = f.read(max_length)
                # Find null terminator
                null_pos = data.find(b'\x00')
                if null_pos != -1:
                    return data[:null_pos].decode('utf-8', errors='ignore')
                return data.decode('utf-8', errors='ignore')
        except:
            return ""


class ConvoyExtractor:
    """Extracts convoy data from Simutrans memory"""

    def __init__(self, mem_reader: MemoryReader):
        self.mem = mem_reader
        self.offsets = {}
        self.convoy_array_address = None

    def load_offsets(self, config_file="config/offsets.json"):
        """Load memory offsets from configuration file"""
        try:
            with open(config_file, 'r') as f:
                config = json.load(f)
                self.offsets = config.get('offsets', {})
                print(f"✓ Loaded offset configuration (version: {config.get('version', 'unknown')})")
                return True
        except FileNotFoundError:
            print(f"✗ Offset configuration not found: {config_file}")
            print(f"  Please run: python offset_discovery.py")
            return False
        except json.JSONDecodeError as e:
            print(f"✗ Invalid JSON in offset configuration: {e}")
            return False

    def find_convoy_array(self):
        """Find the convoy array address in memory"""
        # This is a simplified version - actual implementation would need
        # more sophisticated memory scanning
        #
        # For now, we'll use a placeholder approach where the offset
        # is relative to the base address
        karte_offsets = self.offsets.get('karte_t', {})
        convoy_array_offset = karte_offsets.get('convoi_array', '0x0')

        try:
            offset_val = int(convoy_array_offset, 16)
            # In reality, we'd need to find the karte_t instance first
            # This is a simplified placeholder
            self.convoy_array_address = self.mem.base_address + offset_val
        except ValueError:
            print(f"Warning: Invalid convoy_array offset: {convoy_array_offset}")
            self.convoy_array_address = None

    def get_convoy_count(self):
        """Read the convoy count from vector_tpl"""
        if not self.convoy_array_address:
            return 0

        # vector_tpl structure:
        # - data pointer (8 bytes on 64-bit)
        # - size (4 bytes)
        count_offset = 8
        count = self.mem.read_int(self.convoy_array_address + count_offset)

        # Sanity check
        if count < 0 or count > 10000:
            return 0

        return count

    def parse_convoy_object(self, address):
        """Parse convoi_t object from memory"""
        convoy_offsets = self.offsets.get('convoi_t', {})

        # Read convoy ID
        id_offset = int(convoy_offsets.get('id', '0x0'), 16)
        convoy_id = self.mem.read_int(address + id_offset)

        # Read convoy name
        name_offset = int(convoy_offsets.get('name', '0x0'), 16)
        name_ptr = self.mem.read_pointer(address + name_offset)
        name = self.mem.read_string(name_ptr) if name_ptr else f"Train {convoy_id}"

        # Read position (koord3d)
        pos_offset = int(convoy_offsets.get('position', '0x0'), 16)
        pos_x = self.mem.read_short(address + pos_offset)
        pos_y = self.mem.read_short(address + pos_offset + 2)
        pos_z = self.mem.read_byte(address + pos_offset + 4)
        position = Koord3D(pos_x, pos_y, pos_z)

        # Read speed
        speed_offset = int(convoy_offsets.get('speed', '0x0'), 16)
        speed = self.mem.read_int(address + speed_offset)

        # For now, return simplified data
        # Full implementation would parse schedule, vehicles, etc.
        return ConvoyData(
            id=convoy_id,
            name=name,
            position=position,
            speed=max(0, speed),  # Ensure non-negative
            schedule_name="",  # TODO: Parse schedule
            capacity=100,  # TODO: Calculate from vehicles
            load=50,  # TODO: Calculate from vehicles
            state="DRIVING",  # TODO: Read state
            next_stop_name=""  # TODO: Parse from schedule
        )

    def get_all_convoys(self):
        """Extract all convoy data from memory"""
        convoys = []

        if not self.convoy_array_address:
            self.find_convoy_array()

        if not self.convoy_array_address:
            return convoys

        count = self.get_convoy_count()

        # Read data pointer from vector
        data_ptr = self.mem.read_pointer(self.convoy_array_address)

        for i in range(min(count, 100)):  # Limit to 100 for safety
            try:
                # Read convoy handle pointer
                handle_ptr = self.mem.read_pointer(data_ptr + (i * 8))
                if handle_ptr == 0:
                    continue

                # Parse convoy object
                convoy = self.parse_convoy_object(handle_ptr)
                if convoy and convoy.id > 0:
                    convoys.append(convoy)
            except Exception as e:
                # Skip invalid convoys
                continue

        return convoys

    def get_all_stations(self):
        """Extract all station data from memory"""
        stations = []

        # TODO: Implement station extraction
        # For now, return empty list
        # Full implementation would parse halt_array similar to convoy_array

        return stations
